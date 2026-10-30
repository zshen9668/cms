import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'
import { rateLimit } from '../middleware/security'
import { verifyTurnstile, turnstileSiteKey } from '../plugins/turnstile/index'
import { getTenantId } from '../db/scoped'
import { answerSiteQuestion, getAiQaSettings, hashIp, logAiQaMessage, loadAiQaSession, buildSessionContext, AI_QA_MAX_QUESTION_CHARS } from '../utils/aiQa'
import { getAiSettings } from '../utils/aiSettings'
import { safeError } from '../utils/safeLogger'
import type { Locale } from '../utils/localeResolve'

/**
 * 前台智能问答公开接口。
 *
 * - GET  /api/ai/qa        问答开关与欢迎语（前台组件据此决定是否渲染）
 * - POST /api/ai/ask       提问，返回 { ok, answer, sources }
 *
 * 安全约束：
 * - 限流 8 次/分钟/IP（复用统一 KV 限流器，作用域独立于 /contact 与登录）；
 * - 问题长度上限 500 字，回答上限 1200 字（见 utils/aiQa.ts）；
 * - 配置了 Turnstile 密钥时校验人机令牌（未配置则跳过，与 /contact 行为一致）；
 * - 多租户：数据按当前请求租户过滤（/t/<slug> 下不会串台）；
 * - 失败一律返回结构化错误，不吐堆栈；调用详情写 safeLogger。
 */
export const aiQaRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

function requestLocale(c: any): Locale {
  return c.get('locale') === 'en' ? 'en' : 'zh-CN'
}

aiQaRoutes.get('/qa', rateLimit(60, 60, 'ai-qa-config'), async (c) => {
  const tenantId = getTenantId(c)
  try {
    const [qa, ai] = await Promise.all([getAiQaSettings(c.env, tenantId), getAiSettings(c.env, tenantId)])
    const siteKey = await turnstileSiteKey(c.env)
    return c.json({
      ok: true,
      enabled: qa.enabled,
      welcome: qa.welcome,
      maxQuestionChars: AI_QA_MAX_QUESTION_CHARS,
      turnstileSiteKey: String(siteKey || ''),
    })
  } catch (e) {
    safeError('ai/qa config failed', e)
    return c.json({ ok: false, enabled: false, welcome: '', maxQuestionChars: AI_QA_MAX_QUESTION_CHARS, turnstileSiteKey: '' })
  }
})

/**
 * 会话历史：前台聊天界面刷新后回放同一会话的问答。
 * 只按 session_key 取，且必须带 tenant_id —— 会话键是前端生成的随机串，
 * 但跨租户读取仍要挡住（/t/<slug> 下不能读到主站会话）。
 */
aiQaRoutes.get('/history', rateLimit(30, 60, 'ai-qa-history'), async (c) => {
  const tenantId = getTenantId(c)
  const sessionKey = String(c.req.query('session') || '').trim()
  if (!sessionKey) return c.json({ ok: true, turns: [] })
  try {
    const turns = await loadAiQaSession(c.env, tenantId, sessionKey, 20)
    return c.json({
      ok: true,
      turns: turns.map((t) => ({
        question: t.question,
        answer: t.answer,
        sources: t.sources.map((s) => ({ title: s.title, path: s.path, type: s.type })),
        createdAt: t.createdAt,
      })),
    })
  } catch (e) {
    safeError('ai/history failed', e)
    return c.json({ ok: false, turns: [] })
  }
})

aiQaRoutes.post('/ask', rateLimit(8, 60, 'ai-ask'), async (c) => {
  const tenantId = getTenantId(c)
  const locale = requestLocale(c)
  const ipHash = await hashIp(c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '')

  let body: any = {}
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: '请求体必须是 JSON' }, 400)
  }

  const question = String(body?.question ?? body?.q ?? '').trim().slice(0, AI_QA_MAX_QUESTION_CHARS)
  if (!question) return c.json({ ok: false, error: '请填写问题' }, 400)
  // 会话键由前端生成（随机串），这里只做长度与字符白名单，避免被塞进超长串。
  const sessionKey = String(body?.sessionKey ?? body?.session ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)

  // 配置了 Turnstile 才校验；前台组件未挂验证码时跳过（与 /contact 同一策略）。
  const ts = await verifyTurnstile(c.env, tenantId, String(body?.['cf-turnstile-response'] || ''), c.req.header('cf-connecting-ip'))
  if (!ts.valid) {
    await logAiQaMessage(c.env, { tenantId, channel: 'web', locale, question, ipHash, status: 'rejected', error: '人机校验未通过', sessionKey })
    return c.json({ ok: false, error: '人机校验未通过，请刷新页面后重试' }, 403)
  }

  const qa = await getAiQaSettings(c.env, tenantId)
  if (!qa.enabled) {
    return c.json({ ok: false, error: '本站智能问答当前未开启' }, 503)
  }

  // 同一会话的最近几轮作为上下文，让"那它多少钱"这类追问能被正确理解。
  const history = sessionKey ? await loadAiQaSession(c.env, tenantId, sessionKey, 8) : []
  const sessionContext = buildSessionContext(history)

  const result = await answerSiteQuestion(c.env, { tenantId, question, locale, sessionContext })
  await logAiQaMessage(c.env, {
    tenantId,
    channel: 'web',
    locale,
    question,
    answer: result.answer,
    sources: result.sources,
    model: result.model,
    latencyMs: result.latencyMs,
    ipHash,
    status: result.ok ? 'answered' : 'error',
    error: result.error,
    sessionKey,
    // 会话标题取首问：后台会话列表直接展示，不用再回表查第一条。
    sessionTitle: history.length ? String(history[0]?.question || question) : question,
  })

  if (!result.ok) {
    // 模型/配置类失败按 503 返回：前台据此展示"暂时无法回答，请留言"。
    return c.json({ ok: false, error: '智能问答暂时不可用，请稍后重试或直接留言给我们' }, 503)
  }

  return c.json({
    ok: true,
    answer: result.answer,
    sources: result.sources.map((s) => ({ title: s.title, path: s.path, type: s.type })),
    model: result.model,
  })
})
