/**
 * 智能问答（AI Q&A）核心。
 *
 * 同一条回答链路服务两个入口：
 *   1. 前台问答接口 POST /api/ai/ask（网站访客）
 *   2. 企业微信回调  POST /api/wecom/callback（企业成员）
 *
 * 设计取舍：
 * - **先检索再生成**：先从已发布的文章 / 服务 / 城市 / 案例里按问题关键词捞出
 *   真实站内片段，再交给模型。这样回答有出处（返回 sources），也能显著降低
 *   幻觉——AI 引擎与访客都更信任"有出处的答案"。
 * - **检索不到就明说**：模型被要求"没有依据时直说不知道并引导留资"，
 *   而不是编造。理由同 GEO：编造内容会伤害站点可信度，也违反本站的
 *   「发布前人工审核」承诺。
 * - **不返回站内草稿**：检索只查 status='published' 的文章与 is_active=1 的页面，
 *   避免未审核内容被问答组件泄露出去。
 */
import type { Bindings } from '../types'
import { SettingsStore } from './settingsStore'
import { getAiSettings, runConfiguredAi, type AiSettings } from './aiSettings'
import { getAiResponseText } from './aiJson'
import { getSiteProfile } from './siteProfile'
import { getContactMethods } from './contactSettings'
import { getContactChannelsFromSettings, filterContactChannels } from '../modules/contactChannels/service'
import { safeError, safeWarn } from './safeLogger'
import { errorMessage } from './errors'
import type { Locale } from './localeResolve'

export type AiQaSettings = {
  enabled: boolean
  welcome: string
  maxContextChars: number
  wecomAutoReply: boolean
  prompt: string
}

export const DEFAULT_AI_QA_WELCOME = '你好，我可以基于本站已发布的内容回答问题。请问你想了解什么？'
export const DEFAULT_AI_QA_MAX_CONTEXT_CHARS = 6000
export const AI_QA_MAX_CONTEXT_CEILING = 20000
export const AI_QA_MAX_QUESTION_CHARS = 500
export const AI_QA_MAX_ANSWER_CHARS = 1200

const SETTING_KEYS = ['ai_qa_enabled', 'ai_qa_welcome', 'ai_qa_max_context_chars', 'ai_qa_wecom_auto_reply', 'ai_qa_prompt']

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function normalizeAiQaSettings(input: Partial<AiQaSettings> & Record<string, unknown>): AiQaSettings {
  return {
    // 默认开启：本阶段的交付目标就是可用；不想用时后台一键关闭。
    enabled: input.enabled !== false,
    welcome: String(input.welcome ?? DEFAULT_AI_QA_WELCOME).trim().slice(0, 300),
    maxContextChars: clampInt(input.maxContextChars, 800, AI_QA_MAX_CONTEXT_CEILING, DEFAULT_AI_QA_MAX_CONTEXT_CHARS),
    wecomAutoReply: input.wecomAutoReply !== false,
    prompt: String(input.prompt ?? '').trim().slice(0, 4000),
  }
}

export async function getAiQaSettings(env: Pick<Bindings, 'DB'>, tenantId = 1): Promise<AiQaSettings> {
  const defaults = normalizeAiQaSettings({})
  try {
    const map = await SettingsStore.forTenant(env, tenantId).getMany(SETTING_KEYS)
    return normalizeAiQaSettings({
      // 键不存在时用默认值；显式写 '0' 才是关闭（与 ai_enabled 的语义一致）。
      enabled: map.ai_qa_enabled === '' || map.ai_qa_enabled === undefined ? defaults.enabled : map.ai_qa_enabled !== '0',
      welcome: map.ai_qa_welcome === undefined || map.ai_qa_welcome === '' ? defaults.welcome : map.ai_qa_welcome,
      maxContextChars: map.ai_qa_max_context_chars ? Number(map.ai_qa_max_context_chars) : defaults.maxContextChars,
      wecomAutoReply: map.ai_qa_wecom_auto_reply === '' || map.ai_qa_wecom_auto_reply === undefined
        ? defaults.wecomAutoReply
        : map.ai_qa_wecom_auto_reply !== '0',
      prompt: map.ai_qa_prompt || '',
    })
  } catch (e) {
    safeError('AI QA settings load failed, using defaults', e)
    return defaults
  }
}

export async function saveAiQaSettings(env: Pick<Bindings, 'DB'>, input: Partial<AiQaSettings>, tenantId = 1): Promise<AiQaSettings> {
  const settings = normalizeAiQaSettings(input)
  await SettingsStore.forTenant(env, tenantId).batch([
    ['ai_qa_enabled', settings.enabled ? '1' : '0'],
    ['ai_qa_welcome', settings.welcome],
    ['ai_qa_max_context_chars', String(settings.maxContextChars)],
    ['ai_qa_wecom_auto_reply', settings.wecomAutoReply ? '1' : '0'],
    ['ai_qa_prompt', settings.prompt],
  ])
  return settings
}

// ===========================================================================
// 站内检索（RAG 的"检索"半段）
// ===========================================================================

export type AiQaSource = {
  type: 'article' | 'service' | 'city' | 'case'
  title: string
  path: string
  excerpt: string
}

export type AiQaContext = {
  sources: AiQaSource[]
  contextText: string
}

/** 把问题切成可用于 LIKE 检索的词条；中文没有空格，用 2-6 字的滑窗补足。 */
export function extractSearchTerms(question: string, limit = 8): string[] {
  const raw = String(question || '').trim()
  if (!raw) return []
  const terms: string[] = []
  // 采集上限是最终上限的两倍：先攒够候选再去重截断，避免前面的长短语把后面的短词挤掉。
  const max = Math.max(2, limit) * 2
  const push = (value: string) => {
    if (terms.length >= max) return
    // LIKE 的通配符必须剔除，否则用户输入 % 就会命中整张表。
    const term = value.trim().replace(/[%_\\]/g, '').slice(0, 24)
    if (term.length < 2) return
    if (!terms.includes(term)) terms.push(term)
  }
  // 1) 先按标点/空格切分，得到完整短语（英文单词、中文短语在这里就分好了）
  for (const part of raw.split(/[\s,，。！？；：、,.!?;:()（）\[\]【】"'“”‘’<>《》/\\|-]+/)) push(part)
  // 2) 中文长串再补滑窗。**2 字窗口优先**：中文没有词间空格，"深圳""公司"这类
  //    最短的高信号词最容易被 LIKE 命中；4 字窗口容易带进"在深圳有"这种噪声，
  //    只作为最后的兜底。
  const cjkRuns = raw.match(/[一-龥]{3,}/g) || []
  for (const size of [2, 3, 4]) {
    for (const run of cjkRuns) {
      for (let i = 0; i + size <= run.length; i++) {
        push(run.slice(i, i + size))
        if (terms.length >= max) break
      }
      if (terms.length >= max) break
    }
    if (terms.length >= max) break
  }
  return terms.slice(0, limit)
}

/** LIKE 里的通配符必须转义，否则用户输入 `%` 会匹配全表。 */
function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (c) => '\\' + c)
}

function excerpt(value: unknown, max = 300): string {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * 按问题检索站内已发布内容。
 * 四个来源表各查一次（每条 SQL 都带 tenant_id），合并去重后按"命中词多少"排序，
 * 再按 maxChars 截断，避免把整库塞进提示词把 context 撑爆。
 */
export async function buildAiQaContext(
  env: Pick<Bindings, 'DB'>,
  tenantId: number,
  question: string,
  maxChars = DEFAULT_AI_QA_MAX_CONTEXT_CHARS,
): Promise<AiQaContext> {
  const terms = extractSearchTerms(question)
  if (!terms.length || !env.DB) return { sources: [], contextText: '' }

  const likeClauses = terms.map(() => '(title LIKE ? ESCAPE char(92) OR summary LIKE ? ESCAPE char(92))').join(' OR ')
  const likeBinds = terms.flatMap((term) => ['%' + escapeLikeTerm(term) + '%', '%' + escapeLikeTerm(term) + '%'])
  const serviceClauses = terms.map(() => '(name LIKE ? ESCAPE char(92) OR summary LIKE ? ESCAPE char(92))').join(' OR ')
  const cityClauses = terms.map(() => '(name LIKE ? ESCAPE char(92) OR province LIKE ? ESCAPE char(92))').join(' OR ')
  const caseClauses = terms.map(() => '(client_name LIKE ? ESCAPE char(92) OR industry LIKE ? ESCAPE char(92) OR summary LIKE ? ESCAPE char(92))').join(' OR ')
  const caseBinds = terms.flatMap((term) => {
    const like = '%' + escapeLikeTerm(term) + '%'
    return [like, like, like]
  })

  const rows = await Promise.all([
    env.DB.prepare(
      "SELECT title, slug, summary, substr(COALESCE(content,''), 1, 400) AS body FROM articles WHERE status='published' AND tenant_id=? AND (" + likeClauses + ') LIMIT 4',
    ).bind(tenantId, ...likeBinds).all().catch(() => ({ results: [] })),
    env.DB.prepare(
      'SELECT name, slug, summary FROM services WHERE is_active=1 AND tenant_id=? AND (' + serviceClauses + ') ORDER BY sort_order LIMIT 3',
    ).bind(tenantId, ...likeBinds).all().catch(() => ({ results: [] })),
    env.DB.prepare(
      'SELECT name, slug, province FROM cities WHERE is_active=1 AND tenant_id=? AND (' + cityClauses + ') ORDER BY sort_order LIMIT 3',
    ).bind(tenantId, ...likeBinds).all().catch(() => ({ results: [] })),
    env.DB.prepare(
      'SELECT client_name, slug, industry, region, summary, challenge, solution, results FROM cases WHERE is_active=1 AND tenant_id=? AND (' + caseClauses + ') ORDER BY is_featured DESC, sort_order LIMIT 3',
    ).bind(tenantId, ...caseBinds).all().catch(() => ({ results: [] })),
  ])

  const sources: AiQaSource[] = []
  const blocks: string[] = []
  const push = (source: AiQaSource, detail: string) => {
    if (sources.some((s) => s.path === source.path)) return
    if (!source.title) return
    sources.push({ ...source, excerpt: excerpt(detail || source.excerpt) })
  }

  for (const row of (rows[0].results as any[]) || []) {
    const slug = String(row.slug || '').trim()
    const body = excerpt(row.body, 400)
    if (!body) continue
    push({ type: 'article', title: String(row.title || ''), path: slug ? '/article/' + slug : '/article', excerpt: excerpt(row.summary, 300) }, body)
  }
  for (const row of (rows[1].results as any[]) || []) {
    const slug = String(row.slug || '').trim()
    if (!slug) continue
    push({ type: 'service', title: String(row.name || ''), path: '/service/' + slug, excerpt: excerpt(row.summary, 300) }, String(row.summary || ''))
  }
  for (const row of (rows[2].results as any[]) || []) {
    const slug = String(row.slug || '').trim()
    if (!slug) continue
    push({ type: 'city', title: String(row.name || ''), path: '/city/' + slug, excerpt: excerpt(row.province, 60) }, String(row.province || ''))
  }
  for (const row of (rows[3].results as any[]) || []) {
    const slug = String(row.slug || '').trim()
    const title = String(row.client_name || '').trim() || String(row.industry || '').trim()
    if (!slug || !title) continue
    const detail = [row.industry, row.region, row.summary, row.challenge, row.solution, row.results].map((v) => excerpt(v, 200)).filter(Boolean).join('；')
    push({ type: 'case', title, path: '/case/' + slug, excerpt: excerpt(row.summary, 300) }, detail)
  }

  const lines: string[] = []
  let used = 0
  for (const source of sources) {
    const line = '【' + source.type + '】' + source.title + '（' + source.path + '）：' + source.excerpt
    if (used + line.length > maxChars) break
    lines.push(line)
    used += line.length
  }

  // 只保留真正截断进提示词的来源，避免返回"没给模型看"的出处（那等于假引用）。
  const keptPaths = new Set(lines.map((line) => (/（([^）]+)）/.exec(line)?.[1]) || ''))
  return { sources: sources.filter((s) => keptPaths.has(s.path)), contextText: lines.join('\n') }
}

// ===========================================================================
// 问答
// ===========================================================================

export type AiQaResult = {
  ok: boolean
  answer: string
  sources: AiQaSource[]
  model: string
  latencyMs: number
  error?: string
}

function buildSystemPrompt(params: {
  locale: Locale
  siteName: string
  topic: string
  industry: string
  industryKeywords: string
  services: string
  contactLine: string
  contextText: string
  extraPrompt: string
  /** 同一会话的最近几轮问答，让模型能接住"那它多少钱"这类省略主语的追问。 */
  sessionContext?: string
}): string {
  const language = params.locale === 'en' ? 'English' : '简体中文'
  const contactInstruction = params.contactLine
    ? '如果用户表达了咨询/合作意向，或问题无法从资料中回答，请在结尾自然地引导用户通过以下方式进一步沟通（不要生硬罗列，挑最合适的一两个）：' + params.contactLine
    : '如果用户表达了咨询/合作意向，或者问题无法从资料中回答，请引导用户到「联系我们」页面留言。'
  return [
    '你是「' + params.siteName + '」官网的在线客服顾问，不是冷冰冰的检索工具。',
    params.topic ? '本站主题：' + params.topic + '。' : '',
    params.industry ? '所属行业：' + params.industry + '。' : '',
    params.industryKeywords ? '行业关键词（回答时自然融入，不要堆砌）：' + params.industryKeywords + '。' : '',
    params.services ? '本站核心服务：' + params.services + '。' : '',
    '',
    '回答规则（必须遵守）：',
    '1. 只使用下方【站内资料】中的信息回答。资料里没有的内容，直接说"站内资料里没有这个信息"，不要凭常识编造具体数字、资质、价格、时限或承诺。',
    '2. 不要提及"资料""上下文""检索"这类内部说法，直接把信息讲清楚。',
    '3. 语气要像一位熟悉本行业的真人顾问：先共情用户的实际处境，再给结论和要点；用"你"称呼对方，避免"您好，根据资料显示"这类模板腔。',
    '4. 回答控制在 400 字以内，先给结论再给要点；需要时可列出 2-4 条要点，每条一句话说清。',
    '5. ' + contactInstruction,
    '6. 用' + language + '回答（与用户提问语言一致）。',
    '7. 不要输出 HTML；不要输出免责声明套话。',
    params.extraPrompt ? '\n站点补充要求：\n' + params.extraPrompt : '',
    params.sessionContext ? '\n【本次对话上文】（用于理解追问，不要复述）\n' + params.sessionContext : '',
    '',
    '【站内资料】',
    params.contextText || '（本次没有检索到与问题相关的站内内容）',
  ].filter((line) => line !== '').join('\n')
}

/**
 * 生成一条站内问答的回答。
 * 不抛异常：失败时返回 ok:false + error，调用方据此决定回复什么（企业微信不能 500，
 * 否则企业微信会重推三次）。
 */
export async function answerSiteQuestion(
  env: Pick<Bindings, 'DB' | 'AI' | 'CACHE_KV' | 'JWT_SECRET' | 'EXTERNAL_AI_API_KEY' | 'SITE_NAME'>,
  params: { tenantId: number; question: string; locale?: Locale; force?: boolean; sessionContext?: string },
): Promise<AiQaResult> {
  const startedAt = Date.now()
  const question = String(params.question || '').trim().slice(0, AI_QA_MAX_QUESTION_CHARS)
  const locale: Locale = params.locale === 'en' ? 'en' : 'zh-CN'
  const fail = (error: string): AiQaResult => ({ ok: false, answer: '', sources: [], model: '', latencyMs: Date.now() - startedAt, error })

  if (!question) return fail('问题为空')

  const qaSettings = await getAiQaSettings(env, params.tenantId)
  if (!qaSettings.enabled && !params.force) return fail('智能问答未启用')

  let aiSettings: AiSettings
  try {
    aiSettings = await getAiSettings(env, params.tenantId)
  } catch (e) {
    safeError('AI QA: load AI settings failed', e)
    return fail('AI 设置读取失败')
  }
  if (!aiSettings.enabled) return fail('AI 功能当前未开启，请前往后台「AI设置」启用 AI 通道后再试。')

  try {
    const settingsMap = await SettingsStore.forTenant(env, params.tenantId).getMap('all')
    const siteName = String(settingsMap.site_name || env.SITE_NAME || '本站').trim()
    const profile = getSiteProfile(settingsMap, siteName)
    // 联系渠道按「AI 展示位」筛选：站长可以在「导航与联系 → 联系渠道」里
    // 单独勾选哪些渠道允许被智能问答引用（企业微信 / 个人微信 / 电话 / QQ…），
    // 不必和页头、页脚、联系页共用同一套可见性。
    const aiChannels = filterContactChannels(getContactChannelsFromSettings(settingsMap), 'ai')
    const contactLine = aiChannels.length
      ? aiChannels.map((ch) => (ch.label ? ch.label + ' ' + ch.value : ch.value)).filter(Boolean).join('；')
      : (() => {
          // 没有单独配置 AI 展示位时，回落到联系页渠道，保证回答里仍有可用的联系方式。
          const contacts = getContactMethods(settingsMap)
          return [
            contacts.phones.length ? '电话 ' + contacts.phones.join('、') : '',
            contacts.wechats.length ? '微信 ' + contacts.wechats.join('、') : '',
            contacts.qqs.length ? 'QQ ' + contacts.qqs.join('、') : '',
          ].filter(Boolean).join('；')
        })()

    const context = await buildAiQaContext(env, params.tenantId, question, qaSettings.maxContextChars)
    const prompt = buildSystemPrompt({
      locale,
      siteName,
      topic: profile.topic || '',
      industry: profile.industry || '',
      industryKeywords: String(settingsMap.industry_keywords || '').trim().slice(0, 400),
      services: String(settingsMap.primary_services || '').trim().slice(0, 300),
      contactLine,
      contextText: context.contextText,
      extraPrompt: qaSettings.prompt,
      sessionContext: String(params.sessionContext || '').trim().slice(0, 1600),
    })

    const result = await runConfiguredAi(
      env,
      { messages: [{ role: 'user', content: prompt + '\n\n用户问题：' + question }] },
      { ...aiSettings, maxTokens: Math.max(512, Math.min(aiSettings.maxTokens, 2048)) },
    )
    const answer = getAiResponseText(result).trim().slice(0, AI_QA_MAX_ANSWER_CHARS)
    if (!answer) return fail('模型返回了空回答')
    return {
      ok: true,
      answer,
      sources: context.sources,
      model: aiSettings.provider === 'workers_ai' ? aiSettings.model : aiSettings.externalModel,
      latencyMs: Date.now() - startedAt,
    }
  } catch (e) {
    safeError('AI QA answer failed', e)
    return fail(errorMessage(e, '模型调用失败').slice(0, 300))
  }
}

// ===========================================================================
// 留痕
// ===========================================================================

/** IP 只存 SHA-256 前 32 位十六进制，不落明文（避免 PII）。 */
export async function hashIp(ip: string): Promise<string> {
  const raw = String(ip || '').trim()
  if (!raw) return ''
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

export async function logAiQaMessage(
  env: Pick<Bindings, 'DB'>,
  entry: {
    tenantId: number
    channel: 'web' | 'wecom'
    locale: string
    question: string
    answer?: string
    sources?: AiQaSource[]
    model?: string
    latencyMs?: number
    ipHash?: string
    status?: 'answered' | 'rejected' | 'error'
    error?: string
    msgId?: string
    /** 会话分组键：前台聊天界面按它把多轮问答串成一段对话。 */
    sessionKey?: string
    /** 会话标题（取首问），后台会话列表直接展示，不用再回表取第一条。 */
    sessionTitle?: string
  },
): Promise<void> {
  if (!env.DB) return
  try {
    // 企业微信会重推同一条消息，msg_id 唯一索引 + INSERT OR IGNORE 保证只记一条。
    await env.DB.prepare(
      `INSERT OR IGNORE INTO ai_qa_messages
        (tenant_id, channel, locale, question, answer, sources_json, model, latency_ms, ip_hash, status, error, msg_id, session_key, session_title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      entry.tenantId,
      entry.channel,
      String(entry.locale || 'zh-CN').slice(0, 20),
      String(entry.question || '').slice(0, AI_QA_MAX_QUESTION_CHARS),
      String(entry.answer || '').slice(0, AI_QA_MAX_ANSWER_CHARS),
      entry.sources?.length ? JSON.stringify(entry.sources).slice(0, 4000) : '',
      String(entry.model || '').slice(0, 120),
      Math.max(0, Math.round(entry.latencyMs || 0)),
      String(entry.ipHash || '').slice(0, 64),
      entry.status || 'answered',
      String(entry.error || '').slice(0, 300),
      String(entry.msgId || '').slice(0, 120),
      String(entry.sessionKey || '').slice(0, 80),
      String(entry.sessionTitle || entry.question || '').slice(0, 120),
    ).run()
  } catch (e) {
    safeWarn('AI QA log write failed; continuing', { error: String(e) })
  }
}

/** 会话里的一轮问答（前台聊天界面回放历史、后台会话详情共用）。 */
export type AiQaTurn = {
  id: number
  question: string
  answer: string
  sources: AiQaSource[]
  status: string
  createdAt: string
}

/**
 * 读取某个会话的历史轮次（按时间正序）。
 * 前台用它回放聊天记录，后台用它渲染会话详情。
 */
export async function loadAiQaSession(
  env: Pick<Bindings, 'DB'>,
  tenantId: number,
  sessionKey: string,
  limit = 20,
): Promise<AiQaTurn[]> {
  const key = String(sessionKey || '').trim().slice(0, 80)
  if (!env.DB || !key) return []
  try {
    const rows = (await env.DB.prepare(
      `SELECT id, question, answer, sources_json, status, created_at
       FROM ai_qa_messages
       WHERE tenant_id = ? AND session_key = ?
       ORDER BY created_at ASC, id ASC LIMIT ?`,
    ).bind(tenantId, key, Math.min(50, Math.max(1, limit))).all()).results as any[]
    return rows.map((row) => ({
      id: Number(row.id || 0),
      question: String(row.question || ''),
      answer: String(row.answer || ''),
      sources: parseAiQaSources(row.sources_json),
      status: String(row.status || 'answered'),
      createdAt: String(row.created_at || ''),
    }))
  } catch (e) {
    safeWarn('AI QA session read failed; continuing', { error: String(e) })
    return []
  }
}

/**
 * 把会话历史压成提示词里的「对话上下文」。
 * 只带最近几轮，且只带问题与答案摘要——完整历史会把 context 撑爆，
 * 也会让模型把早期无关话题当成当前意图。
 */
export function buildSessionContext(turns: AiQaTurn[], maxTurns = 4, maxChars = 1200): string {
  const recent = turns.slice(-maxTurns)
  const lines: string[] = []
  let used = 0
  for (const turn of recent) {
    const q = String(turn.question || '').trim().slice(0, 160)
    const a = String(turn.answer || '').trim().replace(/\s+/g, ' ').slice(0, 220)
    if (!q) continue
    const line = '用户：' + q + (a ? '\n你：' + a : '')
    if (used + line.length > maxChars) break
    lines.push(line)
    used += line.length
  }
  return lines.join('\n')
}

/** 解析留痕里的 sources_json，供后台面板展示（坏数据不抛异常）。 */
export function parseAiQaSources(value: unknown): AiQaSource[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item: any) => ({
        type: (['article', 'service', 'city', 'case'].includes(String(item.type)) ? String(item.type) : 'article') as AiQaSource['type'],
        title: String(item.title || '').slice(0, 120),
        path: String(item.path || '').slice(0, 300),
        excerpt: String(item.excerpt || '').slice(0, 400),
      }))
      .filter((item) => item.title)
      .slice(0, 10)
  } catch {
    return []
  }
}
