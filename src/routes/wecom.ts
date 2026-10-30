import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'
import { rateLimit } from '../middleware/security'
import { getTenantId } from '../db/scoped'
import {
  buildWecomTextReply, decryptWecomMessage, encryptWecomMessage, getWecomConfig, hasWecomCallbackConfig,
  parseWecomMessage, sendWecomTextMessage, verifyWecomSignature,
} from '../utils/wecomWork'
import { answerSiteQuestion, getAiQaSettings, logAiQaMessage } from '../utils/aiQa'
import { safeError, safeWarn } from '../utils/safeLogger'

/**
 * 企业微信自建应用回调。
 *
 * - GET  /api/wecom/callback   企业微信后台「接收消息」的 URL 验证
 * - POST /api/wecom/callback   成员消息 → 智能问答 → 回复
 *
 * 为什么默认走「先回 success，再主动推送」而不是被动回复：
 * 企业微信要求 5 秒内响应，超时会重推三次。模型调用（尤其外部 OpenAI 兼容接口）
 * 经常超过 5 秒，被动回复会导致一次提问被处理 3 次、消耗 3 倍配额。
 * 因此这里做「4 秒预算」竞速：
 *   - 4 秒内拿到答案 → 直接被动回复（体验最好，不需要"接收消息"之外的权限）；
 *   - 超时 → 立刻回 success，答案在 waitUntil 里通过 message/send 主动推送给该成员。
 * 两条路径共用同一次模型调用，不会重复消耗。
 *
 * 安全：
 * - 每次回调都校验 msg_signature（SHA1 + 常量时间比较），并用 CorpID 校验密文归属；
 * - 未配置企业微信时返回 503，不暴露任何内部信息；
 * - 明文与密钥不写日志，只把 errcode/errmsg 落在 wecom_message_log。
 */
export const wecomRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/** 被动回复的模型调用预算；超过就让位给主动推送。 */
const PASSIVE_REPLY_BUDGET_MS = 4000

function notConfigured(c: any) {
  return c.text('企业微信未配置', 503)
}

wecomRoutes.get('/callback', rateLimit(60, 60, 'wecom-callback'), async (c) => {
  const config = await getWecomConfig(c.env)
  if (!hasWecomCallbackConfig(config)) return notConfigured(c)

  const msgSignature = c.req.query('msg_signature') || ''
  const timestamp = c.req.query('timestamp') || ''
  const nonce = c.req.query('nonce') || ''
  const echostr = c.req.query('echostr') || ''
  if (!echostr) return c.text('缺少 echostr', 400)

  if (!(await verifyWecomSignature(config.token, timestamp, nonce, echostr, msgSignature))) {
    safeWarn('wecom url verification signature mismatch')
    return c.text('签名校验失败', 403)
  }

  try {
    // 企业微信要求把解密后的明文原样返回，用于确认回调地址归属。
    return c.text(decryptWecomMessage(config.aesKey, echostr, config.corpId))
  } catch (e) {
    safeError('wecom echostr decrypt failed', e)
    return c.text('解密失败', 400)
  }
})

function encryptedFromXml(xml: string): string {
  const match = /<Encrypt>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/Encrypt>/i.exec(String(xml || ''))
  return String(match?.[1] ?? match?.[2] ?? '').trim()
}

wecomRoutes.post('/callback', rateLimit(120, 60, 'wecom-callback'), async (c) => {
  const config = await getWecomConfig(c.env)
  if (!hasWecomCallbackConfig(config)) return notConfigured(c)

  const tenantId = getTenantId(c)
  const msgSignature = c.req.query('msg_signature') || ''
  const timestamp = c.req.query('timestamp') || ''
  const nonce = c.req.query('nonce') || ''

  let rawXml = ''
  try {
    rawXml = await c.req.text()
  } catch {
    return c.text('success')
  }
  const encrypt = encryptedFromXml(rawXml)
  // 极少数情况下企业微信会推明文（安全模式关闭时）。此时无签名可验，直接拒绝，
  // 避免任何人构造明文 XML 就触发模型调用。
  if (!encrypt) return c.text('success')

  if (!(await verifyWecomSignature(config.token, timestamp, nonce, encrypt, msgSignature))) {
    safeWarn('wecom callback signature mismatch')
    return c.text('签名校验失败', 403)
  }

  let messageXml = ''
  try {
    messageXml = decryptWecomMessage(config.aesKey, encrypt, config.corpId)
  } catch (e) {
    safeError('wecom callback decrypt failed', e)
    // 解密失败必须回 success，否则企业微信会持续重推同一条坏消息。
    return c.text('success')
  }

  const message = parseWecomMessage(messageXml)
  const fromUser = message.fromUser
  if (!fromUser) return c.text('success')

  // 非文本消息（图片/语音/位置等）不做问答，但留痕，方便后台排查"为什么没回我"。
  const isText = message.msgType === 'text' && Boolean(message.content)
  const isSubscribe = message.msgType === 'event' && message.event === 'subscribe'
  if (!isText && !isSubscribe) {
    c.executionCtx.waitUntil(logWecomIncoming(c.env, {
      tenantId, message, status: 'ignored', error: '暂不支持的消息类型：' + message.msgType,
    }))
    return c.text('success')
  }

  const question = isText ? message.content : '用户刚刚关注了企业微信，请用一句话打招呼并说明可以问什么。'

  const resultPromise = (async () => {
    const qa = await getAiQaSettings(c.env, tenantId)
    if (!qa.enabled) {
      return { ok: false as const, answer: '', error: '智能问答未启用', sources: [], model: '', latencyMs: 0 }
    }
    if (!qa.wecomAutoReply) {
      return { ok: false as const, answer: '', error: '企业微信自动回复已关闭', sources: [], model: '', latencyMs: 0 }
    }
    const result = await answerSiteQuestion(c.env, { tenantId, question, locale: 'zh-CN' })
    await logWecomIncoming(c.env, {
      tenantId,
      message,
      answer: result.answer,
      status: result.ok ? 'processed' : 'error',
      error: result.error,
    })
    await logAiQaMessage(c.env, {
      tenantId,
      channel: 'wecom',
      locale: 'zh-CN',
      question,
      answer: result.answer,
      sources: result.sources,
      model: result.model,
      latencyMs: result.latencyMs,
      status: result.ok ? 'answered' : 'error',
      error: result.error,
      msgId: message.msgId,
    })
    return result
  })()

  const budget = new Promise<null>((resolve) => setTimeout(() => resolve(null), PASSIVE_REPLY_BUDGET_MS))
  const result = await Promise.race([resultPromise, budget])

  const replyText = result?.ok && result.answer
    ? result.answer
    : '抱歉，我暂时无法回答这个问题。已记录你的提问，我们会尽快通过联系方式回复你。'

  if (result) {
    // 预算内拿到结果：被动回复，成员无需等待第二次推送。
    try {
      const encrypted = encryptWecomMessage(config.aesKey, buildWecomTextReply({
        toUser: fromUser,
        fromUser: message.toUser || config.corpId,
        content: replyText,
      }), config.corpId)
      const signature = await wecomReplySignature(config.token, timestamp, nonce, encrypted)
      return c.text(
        '<xml><Encrypt><![CDATA[' + encrypted + ']]></Encrypt>' +
        '<MsgSignature><![CDATA[' + signature + ']]></MsgSignature>' +
        '<TimeStamp>' + String(timestamp || Math.floor(Date.now() / 1000)) + '</TimeStamp>' +
        '<Nonce><![CDATA[' + nonce + ']]></Nonce></xml>',
        { headers: { 'content-type': 'application/xml; charset=utf-8' } },
      )
    } catch (e) {
      safeError('wecom passive reply failed; falling back to active push', e)
    }
  }

  // 超预算或被动回复失败：先回 success 避免重推，再在后台主动推送。
  c.executionCtx.waitUntil((async () => {
    const settled = await resultPromise.catch(() => null)
    const text = settled?.ok && settled.answer ? settled.answer : replyText
    const sent = await sendWecomTextMessage(c.env, fromUser, text)
    if (!sent.ok) {
      safeWarn('wecom active push failed', { error: sent.error })
      await logWecomIncoming(c.env, {
        tenantId, message, answer: text, status: 'error', error: '主动推送失败：' + String(sent.error || ''),
      })
    }
  })())

  return c.text('success')
})

/** 被动回复 XML 需要同时带上 MsgSignature（SHA1(token, timestamp, nonce, encrypt)）。 */
async function wecomReplySignature(token: string, timestamp: string, nonce: string, encrypted: string): Promise<string> {
  const sorted = [token, String(timestamp || ''), String(nonce || ''), encrypted].sort().join('')
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(sorted))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function logWecomIncoming(
  env: Pick<Bindings, 'DB'>,
  entry: {
    tenantId: number
    message: { msgId: string; msgType: string; fromUser: string; agentId: string; content: string }
    answer?: string
    status: 'processed' | 'ignored' | 'error'
    error?: string
  },
): Promise<void> {
  if (!env.DB) return
  try {
    await env.DB.prepare(
      `INSERT INTO wecom_message_log
        (tenant_id, direction, msg_id, msg_type, from_user, agent_id, question, answer, status, error)
       VALUES (?, 'in', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      entry.tenantId,
      String(entry.message.msgId || '').slice(0, 120),
      String(entry.message.msgType || 'text').slice(0, 20),
      String(entry.message.fromUser || '').slice(0, 200),
      String(entry.message.agentId || '').slice(0, 40),
      String(entry.message.content || '').slice(0, 500),
      String(entry.answer || '').slice(0, 1200),
      entry.status,
      String(entry.error || '').slice(0, 300),
    ).run()
  } catch (e) {
    safeWarn('wecom message log write failed; continuing', { error: String(e) })
  }
}
