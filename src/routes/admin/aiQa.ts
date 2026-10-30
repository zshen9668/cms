import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { getTenantId } from '../../db/scoped'
import { resolveSiteUrl } from '../../utils/siteUrl'
import { safeError } from '../../utils/safeLogger'
import { errorMessage } from '../../utils/errors'
import { hasSystemSecret } from '../../utils/systemSecrets'
import {
  answerSiteQuestion, getAiQaSettings, normalizeAiQaSettings, parseAiQaSources, saveAiQaSettings,
  AI_QA_MAX_QUESTION_CHARS, type AiQaSettings,
} from '../../utils/aiQa'
import { getWecomConfig, hasWecomCallbackConfig, sendWecomTextMessage } from '../../utils/wecomWork'
import { SettingsStore } from '../../utils/settingsStore'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { getContactChannelsFromSettings, filterContactChannels } from '../../modules/contactChannels/service'
import { renderAiQaPage, type AiQaLogRow, type AiQaConversation, type WecomStatus } from '../../templates/adminAiQa'

/**
 * 后台「智能问答」面板。
 * 路由：/admin/ai-qa（页面）+ /admin/ai-qa/{save,test,wecom-test,clear-log}
 * 全部落在 /admin/* 下，因此自动继承 requireAdmin 与 CSRF 双提交校验。
 */
export const adminAiQaRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function loadRecentLogs(env: Bindings, tenantId: number, limit = 30): Promise<AiQaLogRow[]> {
  try {
    const rows = (await env.DB.prepare(
      `SELECT id, channel, locale, question, answer, sources_json, model, latency_ms, status, error, created_at
       FROM ai_qa_messages WHERE tenant_id=? ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(tenantId, limit).all()).results as any[]
    return rows.map((row) => ({
      id: Number(row.id || 0),
      channel: String(row.channel || 'web'),
      locale: String(row.locale || 'zh-CN'),
      question: String(row.question || ''),
      answer: String(row.answer || ''),
      sources: parseAiQaSources(row.sources_json),
      model: String(row.model || ''),
      latencyMs: Number(row.latency_ms || 0),
      status: String(row.status || 'answered'),
      error: String(row.error || ''),
      created_at: String(row.created_at || ''),
    }))
  } catch (e) {
    safeError('AI QA log read failed', e)
    return []
  }
}

/**
 * 按会话聚合问答记录，供后台「聊天管理」使用。
 *
 * 旧面板只有一条条流水日志，运营看不出"同一个访客问了哪几轮、最后有没有被回答"。
 * 这里按 session_key 分组（企业微信按成员 userid 分组），每组带上轮次与时间范围。
 * 没有 session_key 的历史记录（0007 迁移之前的）按单条会话展示，不丢数据。
 */
async function loadConversations(env: Bindings, tenantId: number, limit = 20): Promise<AiQaConversation[]> {
  try {
    const rows = (await env.DB.prepare(
      `SELECT session_key, session_title, channel, locale, question, answer, sources_json, status, created_at
       FROM ai_qa_messages
       WHERE tenant_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 400`,
    ).bind(tenantId).all()).results as any[]

    const groups = new Map<string, AiQaConversation>()
    for (const row of rows) {
      const key = String(row.session_key || '').trim() || ('single-' + String(row.created_at || '') + '-' + String(row.question || '').slice(0, 20))
      let group = groups.get(key)
      if (!group) {
        group = {
          sessionKey: key,
          title: String(row.session_title || row.question || '').slice(0, 120),
          channel: String(row.channel || 'web'),
          locale: String(row.locale || 'zh-CN'),
          turns: [],
          lastAt: String(row.created_at || ''),
          firstAt: String(row.created_at || ''),
        }
        groups.set(key, group)
      }
      group.turns.push({
        question: String(row.question || ''),
        answer: String(row.answer || ''),
        sources: parseAiQaSources(row.sources_json),
        status: String(row.status || 'answered'),
        createdAt: String(row.created_at || ''),
      })
      // rows 是按时间倒序取的，所以第一条就是最新时间。
      group.firstAt = String(row.created_at || '')
    }

    const list = [...groups.values()]
    for (const group of list) group.turns.reverse() // 组内改回正序，读起来是正常对话顺序
    return list.slice(0, limit)
  } catch (e) {
    safeError('AI QA conversation read failed', e)
    return []
  }
}

async function loadWecomStatus(env: Bindings, siteUrl: string, tenantId = 1): Promise<WecomStatus> {
  // 逐项查配置状态，而不是只看 getWecomConfig 的返回值：缺哪一项要能直接告诉站长。
  const [hasCorpId, hasAgentId, hasSecret, hasToken, hasAesKey] = await Promise.all([
    hasSystemSecret(env, 'WECHAT_WORK_CORP_ID'),
    hasSystemSecret(env, 'WECHAT_WORK_AGENT_ID'),
    hasSystemSecret(env, 'WECHAT_WORK_SECRET'),
    hasSystemSecret(env, 'WECHAT_WORK_TOKEN'),
    hasSystemSecret(env, 'WECHAT_WORK_AES_KEY'),
  ])
  const config = await getWecomConfig(env).catch(() => null)

  let lastError = ''
  try {
    const row = await env.DB.prepare(
      "SELECT error FROM wecom_message_log WHERE tenant_id=? AND status='error' AND error <> '' ORDER BY id DESC LIMIT 1",
    ).bind(tenantId).first() as any
    lastError = String(row?.error || '')
  } catch {
    lastError = ''
  }

  return {
    configured: hasCorpId && hasSecret && hasAgentId,
    callbackConfigured: hasWecomCallbackConfig(config),
    hasCorpId,
    hasAgentId,
    hasSecret,
    hasToken,
    hasAesKey,
    callbackUrl: siteUrl.replace(/\/$/, '') + '/api/wecom/callback',
    lastError,
  }
}

/**
 * 表单 → 设置。
 * 复选框未勾选时浏览器不会提交该键，因此「键不存在」就是「关闭」；
 * 两个开关都按 `=== '1'` 判定，避免"清空表单反而把功能打开"。
 */
function normalizeFromBody(body: Record<string, unknown>): AiQaSettings {
  return normalizeAiQaSettings({
    enabled: body.ai_qa_enabled === '1',
    wecomAutoReply: body.ai_qa_wecom_auto_reply === '1',
    welcome: String(body.ai_qa_welcome ?? ''),
    maxContextChars: Number(body.ai_qa_max_context_chars),
    prompt: String(body.ai_qa_prompt ?? ''),
  })
}

adminAiQaRoutes.get('/ai-qa', async (c) => {
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c).catch(() => '')
  const [settings, logs, wecom, settingsMap, conversations, wecomLogs] = await Promise.all([
    getAiQaSettings(c.env, tenantId),
    loadRecentLogs(c.env, tenantId),
    loadWecomStatus(c.env, siteUrl, tenantId),
    SettingsStore.forTenant(c.env, tenantId).getMap('all').catch(() => ({} as Record<string, string>)),
    loadConversations(c.env, tenantId),
    c.env.DB.prepare(
      `SELECT id, direction, msg_type, from_user, question, answer, status, error, created_at
       FROM wecom_message_log WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`
    ).bind(tenantId).all().then((r) => (r.results as any[]).map((row: any) => ({
      id: Number(row.id || 0),
      direction: String(row.direction || ''),
      msg_type: String(row.msg_type || ''),
      from_user: String(row.from_user || ''),
      question: String(row.question || ''),
      answer: String(row.answer || ''),
      status: String(row.status || ''),
      error: String(row.error || ''),
      created_at: String(row.created_at || ''),
    }))),
  ])
  // 问答回答里会引用哪些联系方式，由「联系渠道」的 AI 展示位决定：
  // 站长可以只勾选企业微信、只勾选个人微信，或两者都勾。
  const aiChannels = filterContactChannels(getContactChannelsFromSettings(settingsMap), 'ai')
    .map((ch) => ({ type: ch.type, label: ch.label || ch.type, value: ch.value }))
  return c.html(renderAiQaPage({
    settings,
    logs,
    wecom,
    aiChannels,
    conversations,
    wecomLogs,
    message: String(c.req.query('ok') || '').trim(),
    error: String(c.req.query('error') || '').trim(),
    testAnswer: String(c.req.query('answer') || '').slice(0, 4000),
    testSources: String(c.req.query('sources') || '').split('|').filter(Boolean).slice(0, 10),
    siteName: await resolveAdminSiteName(c.env, tenantId),
    cspNonce: (c as any).get("cspNonce") || "",
    csrfToken: (c as any).get("csrfToken") || "",
  }))
})

adminAiQaRoutes.post('/ai-qa/save', async (c) => {
  const body = (await c.req.parseBody()) as Record<string, unknown>
  try {
    await saveAiQaSettings(c.env, normalizeFromBody(body), getTenantId(c))
    return c.redirect('/admin/ai-qa?ok=' + encodeURIComponent('问答设置已保存'))
  } catch (e) {
    safeError('AI QA settings save failed', e)
    return c.redirect('/admin/ai-qa?error=' + encodeURIComponent(errorMessage(e, '保存失败')))
  }
})

adminAiQaRoutes.post('/ai-qa/test', async (c) => {
  const body = await c.req.parseBody()
  const question = String(body.question || '').trim().slice(0, AI_QA_MAX_QUESTION_CHARS)
  if (!question) return c.redirect('/admin/ai-qa?error=' + encodeURIComponent('请填写要测试的问题'))
  const tenantId = getTenantId(c)
  // force=true：即使问答开关是关的也能测试，避免"必须先上线才能验证"的鸡生蛋问题。
  const result = await answerSiteQuestion(c.env, { tenantId, question, locale: 'zh-CN', force: true })
  if (!result.ok) {
    return c.redirect('/admin/ai-qa?error=' + encodeURIComponent('测试失败：' + String(result.error || '未知原因')))
  }
  return c.redirect(
    '/admin/ai-qa?ok=' + encodeURIComponent('测试成功（未经过限流，正式接口仍受 8 次/分钟限制）') +
    '&answer=' + encodeURIComponent(result.answer) +
    '&sources=' + encodeURIComponent(result.sources.map((s) => s.title + ' ' + s.path).join('|')),
  )
})

adminAiQaRoutes.post('/ai-qa/wecom-test', async (c) => {
  const body = await c.req.parseBody()
  const toUser = String(body.to_user || '').trim()
  if (!toUser) return c.redirect('/admin/ai-qa?error=' + encodeURIComponent('请填写企业微信成员 userid'))
  const sent = await sendWecomTextMessage(c.env, toUser, '白标 CMS 测试消息：如果收到这条消息，说明企业微信 CorpID / Secret / AgentId 配置正确。')
  if (!sent.ok) {
    return c.redirect('/admin/ai-qa?error=' + encodeURIComponent('发送失败：' + String(sent.error || '未知原因')))
  }
  return c.redirect('/admin/ai-qa?ok=' + encodeURIComponent('测试消息已发送，请在企业微信中查看'))
})

adminAiQaRoutes.post('/ai-qa/clear-log', async (c) => {
  try {
    await c.env.DB.prepare('DELETE FROM ai_qa_messages WHERE tenant_id=?').bind(getTenantId(c)).run()
    return c.redirect('/admin/ai-qa?ok=' + encodeURIComponent('问答记录已清空'))
  } catch (e) {
    safeError('AI QA log clear failed', e)
    return c.redirect('/admin/ai-qa?error=' + encodeURIComponent(errorMessage(e, '清空失败')))
  }
})
