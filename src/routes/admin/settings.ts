import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { readSettingsMap, saveSetting, syncPageSeoKeywords, generateKeywordMatrix, getTenantId, getCurrentAdmin, getAiRouteStatus, deleteDuplicateKeywordRows } from './shared'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { safeError } from '../../utils/safeLogger'
import { renderSettingsPage, renderAiSettingsPage, renderAiPromptsPage } from '../../templates/admin'
import { SettingsStore } from '../../utils/settingsStore'
import { getIndustryPreset, INDUSTRY_PRESETS, presetToSettings, loadPresetFromDb, savePresetToDb, deletePresetFromDb, listPresetsFromDb } from '../../utils/industryPresets'
import { parseHomeSectionOrder } from '../../templates/homeSections'
import { hasSystemSecret, saveSystemSecret } from '../../utils/systemSecrets'
import { purgeCacheAll } from '../../middleware/cache'
import { generateAiPageContent } from '../../utils/aiPageContent'
import { getAiSettings, saveAiSettings, runConfiguredAi, normalizeAiSettings } from '../../utils/aiSettings'
import { getAiResponseText, parseAiJson } from '../../utils/aiJson'
import { getAiPromptSettings, saveAiPromptSettings, AI_PROMPT_SPECS, validateAiPromptVariables, composeAiPromptWithSystemContacts } from '../../utils/aiPrompts'
import { loadSiteProfileSettings, getSiteProfile } from '../../utils/siteProfile'
import { normalizeKeywordCandidates, alignSeoKeywordsToContent } from '../../utils/autoSeo'
import { errorMessage } from '../../utils/errors'
import { validatePasswordStrength, hashPassword, getPbkdf2Iterations } from '../../utils/password'
import { serializePageSettings, getPageSettings, getPageNavigationLabels, isManagedPageKey } from '../../utils/pageSettings'

export const adminSettingsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const AI_PROMPT_TASK_KEYS = ['global', 'news', 'city', 'service', 'article', 'keyword', 'landing', 'page'] as const

/** 按当前站点画像，一次性生成全部任务的行业化提示词并落库。返回 {ok, count, error}。 */
async function generateIndustryPromptsForSite(env: Bindings, tenantId: number, aiSettings: any, industryPresetId?: string): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const settings = await readSettingsMap(env, tenantId)

    // 如果指定了预设，使用预设的行业配置（优先级高于 settings 表，确保随模板切换而变化）
    let presetLabel = ''
    let presetIndustry = ''
    let presetKeywords = ''
    let presetServices = ''
    let presetTargetCustomers = ''
    let presetScenarios = ''

    if (industryPresetId) {
      const preset = INDUSTRY_PRESETS.find((p) => p.id === industryPresetId) || await loadPresetFromDb(env, tenantId, industryPresetId)
      if (preset) {
        presetLabel = preset.label
        presetIndustry = preset.industry
        presetKeywords = preset.industryKeywords || ''
        presetServices = preset.primaryServices || ''
        presetTargetCustomers = preset.targetCustomers || ''
        presetScenarios = preset.applicationScenarios || ''
      }
    }

    // 未选预设时，回落到 settings 表（兜底生成）
    if (!presetIndustry) {
      presetIndustry = String(settings.site_industry || settings.industry_type || '').trim()
      presetLabel = String(settings.site_profile_name || '').trim()
      presetKeywords = String(settings.industry_keywords || '').trim()
      presetServices = String(settings.primary_services || '').trim()
      presetTargetCustomers = String(settings.target_customers || '').trim()
      presetScenarios = String(settings.application_scenarios || '').trim()
    }

    const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
    const profile = `当前网站：${siteName}，行业：${presetIndustry || '未指定'}，行业关键词：${presetKeywords || '未指定'}，目标客户：${presetTargetCustomers || '未指定'}，服务特色：${presetServices || '未指定'}，应用场景：${presetScenarios || '未指定'}。`

    const webSearchEnabled = aiSettings.provider === 'openai_compatible' && aiSettings.webSearchEnabled
    const webSearchInstruction = webSearchEnabled
      ? '先检索该行业最新业务内容再校准，确保提示词与当前行业实际场景一致。'
      : '基于给定行业画像生成，不要编造与该行业无关的内容。'

    const taskList = AI_PROMPT_TASK_KEYS
      .map((k) => `- ${k}（${AI_PROMPT_SPECS[k].title}）：${AI_PROMPT_SPECS[k].purpose}`)
      .join('\n')
    const metaPrompt = `你是一名 SEO 与行业内容专家。${profile}
${webSearchInstruction}
请为下面每一个任务各生成一段不超过 200 字的"行业化补充提示词"，用于叠加在该任务的默认提示词之后：
${taskList}

要求：
1. 每段聚焦该行业在该任务下的具体输出风格、术语、读者、结构；
2. 只写"补充规则"，不重复通用 SEO 底线，不要解释；
3. 严格输出 JSON 对象，键为上面的英文任务名，值为提示词字符串，不要输出任何其它文字或 Markdown 代码块。`
    const result = await runConfiguredAi(env, { messages: [{ role: 'user', content: metaPrompt }] }, aiSettings)
    const raw = getAiResponseText(result).trim()
    const parsed = parseAiJson<Record<string, unknown>>(raw)
    if (!parsed || typeof parsed !== 'object') throw new Error('AI 未返回可解析的 JSON，请先完善站点行业画像再试')
    const generated: Record<string, string> = {}
    for (const k of AI_PROMPT_TASK_KEYS) {
      const value = String((parsed as Record<string, unknown>)[k] ?? '').trim().slice(0, 2400)
      if (value) generated[k] = value
    }
    if (!Object.keys(generated).length) throw new Error('AI 未返回可用提示词，请先完善站点行业画像再试')
    await saveAiPromptSettings(env, generated as any, tenantId)
    return { ok: true, count: Object.keys(generated).length }
  } catch (e) {
    return { ok: false, count: 0, error: String((e as any)?.message || e) }
  }
}

adminSettingsRoutes.get('/page-nav-labels', async (c) => {
  const settings = await readSettingsMap(c.env, getTenantId(c))
  return c.json(getPageNavigationLabels(settings, 'zh-CN'))
})

adminSettingsRoutes.get('/settings', async (c) => {
  const map = await SettingsStore.for(c.env).getMapExcluding(['ai_page:', 'ai_', 'secret:'])
  const account = await getCurrentAdmin(c)
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  map.__account_email = String(account?.email || '')
  map.__account_saved = c.req.query('account_saved') === '1' ? '1' : ''
  map.__account_error = c.req.query('account_error') || ''
  map.__home_order_saved = c.req.query('home_order_saved') === '1' ? '1' : ''
  // 行业配置保存后的矩阵重建反馈
  map.matrix = c.req.query('matrix') || ''
  map.seo = c.req.query('seo') || ''
  map.cities = c.req.query('cities') || ''
  map.services = c.req.query('services') || ''
  map.matrix_ok = c.req.query('matrix_ok') || ''
  return c.html(renderSettingsPage(map, c.req.query('error') || '', c.req.query('saved') === '1', c.req.query('ai') || '', siteName, cspNonce, csrfToken))
})

adminSettingsRoutes.post('/settings/home-order', async (c) => {
  const b = await c.req.parseBody() as Record<string, string>
  // 新表单提交单个 order 字段（"intro,services,-cases,..."，前缀 - 表示隐藏）；
  // 旧表单提交 order_N / show_N，这里保留兼容，避免老页面缓存里的表单提交后丢配置。
  const encoded = typeof b.order === 'string' && b.order.trim()
    ? b.order
    : [0, 1, 2, 3, 4].map((i) => (b[`show_${i}`] === "1" || b[`show_${i}`] === "on" ? "" : "-") + (b[`order_${i}`] || "")).join(",")
  const order = parseHomeSectionOrder(encoded)
  await SettingsStore.forTenant(c.env, getTenantId(c)).set("home_section_order", order.map((slot) => (slot.visible ? "" : "-") + slot.key).join(","))
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/settings?home_order_saved=1')
})

adminSettingsRoutes.post('/settings/industry', async (c) => {
  const b = await c.req.parseBody()
  const preset = getIndustryPreset(String(b.preset_id || ''))
  if (!preset) return c.redirect('/admin/settings?error=' + encodeURIComponent('请选择有效的行业模板'))
  const settings = presetToSettings(preset)
  await SettingsStore.for(c.env).batch(Object.entries(settings))
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/settings?industry_applied=1')
})

adminSettingsRoutes.post('/settings/ai-seo', async (c) => {
  const body = await c.req.parseBody()
  const target = String(body.target || '').trim()
  // 受管页面白名单与「前台页面」共用同一份定义，案例页等新页面自动同步可用。
  if (target !== 'site' && !isManagedPageKey(target)) return c.redirect('/admin/settings?error=' + encodeURIComponent('无效的 AI SEO 页面'))
  try {
    const settings = await readSettingsMap(c.env, getTenantId(c))
    if (target === 'site') {
      const siteName = String(settings.site_name || c.env.SITE_NAME || '网站内容平台').trim()
      const ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'page', pageLabel: siteName + '首页SEO', pagePath: '/', title: String(settings.site_title || ''), summary: String(settings.site_description || ''), sourceContent: String(settings.site_description || '') })
      if (!ai) throw new Error('AI没有返回通过质量门槛的站点 SEO 内容')
      const keywords = alignSeoKeywordsToContent([siteName + '服务', settings.site_topic || '', settings.site_industry || '', ...normalizeKeywordCandidates([settings.primary_keywords || '', settings.industry_keywords || '', settings.site_keywords || ''].join(','), 20)], ai.title, ai.summary, ai.content, 5)
      void keywords
      await saveSetting(c.env, 'site_title', ai.title.slice(0, 120), getTenantId(c))
      await saveSetting(c.env, 'site_description', ai.summary.slice(0, 180), getTenantId(c))
      await saveSetting(c.env, 'site_seo_ai_generated', '1', getTenantId(c))
      await syncPageSeoKeywords(c.env, getTenantId(c))
      c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
      return c.redirect('/admin/settings?saved=1&ai=site')
    }
    const pages = getPageSettings(settings)
    const page = pages[target as keyof typeof pages]
    const ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'page', pageLabel: page.labelZh, pagePath: page.path, title: page.titleZh, summary: page.subtitleZh, sourceContent: page.contentZh })
    if (!ai) throw new Error('AI没有返回通过质量门槛的页面内容')
    const keywords = alignSeoKeywordsToContent([page.labelZh, page.labelZh + '服务', page.labelZh + '办理', page.labelZh + '流程', settings.site_topic || '', settings.site_industry || '', ...normalizeKeywordCandidates([settings.primary_keywords || '', settings.industry_keywords || '', settings.site_keywords || ''].join(','), 20)], ai.title, ai.summary, ai.content, 5)
    pages[target as keyof typeof pages] = { ...page, titleZh: ai.title, subtitleZh: ai.summary, contentZh: ai.content, seoKeywordsZh: keywords.join(','), aiGenerated: true }
    await saveSetting(c.env, 'page_settings_json', serializePageSettings(pages), getTenantId(c))
    if (target === 'home') await saveSetting(c.env, 'site_seo_ai_generated', '1', getTenantId(c))
    await syncPageSeoKeywords(c.env, getTenantId(c))
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    return c.redirect('/admin/settings?saved=1&ai=' + encodeURIComponent(target))
  } catch (e) { safeError('settings AI SEO generation failed', e); return c.redirect('/admin/settings?error=' + encodeURIComponent(errorMessage(e, 'AI SEO生成失败'))) }
})

adminSettingsRoutes.post('/account', async (c) => {
  const me = await getCurrentAdmin(c)
  if (!me) return c.redirect('/admin/login')
  const b = await c.req.parseBody()
  const email = String(b.email || '').trim().toLowerCase()
  const password = String(b.password || '')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.redirect('/admin/settings?account_error=' + encodeURIComponent('邮箱格式不正确'))
  if (password) { const passwordError = validatePasswordStrength(password, email); if (passwordError) return c.redirect('/admin/settings?account_error=' + encodeURIComponent(passwordError)) }
  try { if (password) { const hash = await hashPassword(password, getPbkdf2Iterations(c.env)); await c.env.DB.prepare("UPDATE admin_users SET email=?, password_hash=?, role='admin' WHERE id=?").bind(email, hash, me.id).run() } else { await c.env.DB.prepare("UPDATE admin_users SET email=?, role='admin' WHERE id=?").bind(email, me.id).run() } } catch (e) { safeError('update admin account failed', e); return c.redirect('/admin/settings?account_error=' + encodeURIComponent('保存失败')) }
  return c.redirect('/admin/settings?account_saved=1')
})

adminSettingsRoutes.post('/settings', async (c) => {
  const b = await c.req.parseBody()
  const has = (key: string) => Object.prototype.hasOwnProperty.call(b, key)
  const value = (key: string, max = 2000) => String((b as any)[key] ?? '').trim().slice(0, max)
  const updates: Record<string, string> = {}
  const textFields: Record<string, number> = { site_name: 80, site_profile_name: 60, site_url: 500, site_title: 200, site_description: 1000, site_topic: 120, site_industry: 80, primary_services: 1000, primary_keywords: 1200, industry_keywords: 1600, news_categories: 500, home_section_order: 200, footer_copyright: 200, footer_disclaimer: 500, footer_ai_notice: 500, footer_links: 1500, turnstile_site_key: 120, turnstile_secret_key: 200, site_favicon: 500, site_default_title_template: 300, site_default_desc_template: 300, site_llms_content: 10000 }
  for (const [key, max] of Object.entries(textFields)) { if (has(key)) updates[key] = value(key, max) }
  if (has('site_url')) { const siteUrl = updates.site_url || ''; if (siteUrl) { try { const parsed = new URL(siteUrl); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('invalid'); updates.site_url = parsed.origin + parsed.pathname.replace(/\/$/, '') + parsed.search + parsed.hash } catch { return c.redirect('/admin/settings?error=' + encodeURIComponent('公开站点地址必须是完整的 http:// 或 https:// 地址。')) } } }
  // 搜索引擎推送密钥、Resend 邮件密钥、Google 服务账号统一在「系统密钥」页面管理，本页不再重复收集。

  // 记录画像相关字段变更：若「网站行业」或「核心主题」变了，清理并重新生成关键词矩阵
  const oldSettings = await readSettingsMap(c.env, getTenantId(c))
  const oldIndustry = String(oldSettings.site_industry || '').trim()
  const oldTopic = String(oldSettings.site_topic || '').trim()
  const newIndustry = String(updates.site_industry || '').trim()
  const newTopic = String(updates.site_topic || '').trim()
  const industryChanged = oldIndustry !== newIndustry || oldTopic !== newTopic

  // 画像名称作为行业名称：若用户填了画像名称，且行业为空，则将画像名称作为行业使用，
  // 让自定义画像名称能在「行业与业务配置」中作为行业选项使用。
  if (updates.site_profile_name && !newIndustry && !oldIndustry) {
    updates.site_industry = updates.site_profile_name
  }

  if (Object.keys(updates).length) await SettingsStore.for(c.env).batch(Object.entries(updates))
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))

  // 画像名称/行业/主题变更后，自动清理旧关键词并重新生成矩阵
  if (industryChanged) {
    try {
      await deleteDuplicateKeywordRows(c.env, getTenantId(c))
      await generateKeywordMatrix(c.env)
    } catch (e) {
      safeError('keyword matrix regenerate after industry change failed', e)
    }
    return c.redirect('/admin/settings?saved=1&message=' + encodeURIComponent('画像名称/行业/主题已更新，关键词矩阵已自动清理并重新生成。'))
  }

  return c.redirect('/admin/settings?saved=1')})

adminSettingsRoutes.get('/ai-settings', async (c) => {
  // 必须按当前租户读取：POST 保存到 getTenantId(c)，这里若读默认租户 1，
  // 多租户下会出现"保存成功但刷新后配置没变"。
  const settings = await getAiSettings(c.env, getTenantId(c))
  const externalApiKeyConfigured = await hasSystemSecret(c.env, 'EXTERNAL_AI_API_KEY')
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  return c.html(renderAiSettingsPage({ ...settings, externalApiKeyConfigured, siteName, cspNonce, csrfToken, saved: c.req.query('saved') === '1', test: c.req.query('test') || '', testModel: c.req.query('model') || '', testProvider: c.req.query('provider') || '', testResponse: c.req.query('response') || '', testMessage: c.req.query('message') || '', testTask: c.req.query('task') || 'connectivity', testQuality: c.req.query('quality') || '', industry_prompt: c.req.query('industry_prompt') || '', industry_prompt_count: Number(c.req.query('industry_prompt_count') || 0), industry_prompt_error: c.req.query('industry_prompt_error') || '', webSearchEnabled: settings.webSearchEnabled }))
})

adminSettingsRoutes.post('/ai-settings', async (c) => {
  const b = await c.req.parseBody()
  await saveAiSettings(c.env, normalizeAiSettings({ enabled: b.ai_enabled === 'on', aiProvider: String(b.ai_provider || ''), model: String(b.ai_model || ''), customModel: String(b.ai_custom_model || ''), temperature: Number(b.ai_temperature), maxTokens: Number(b.ai_max_tokens), externalBaseUrl: String(b.ai_external_base_url || ''), externalModel: String(b.ai_external_model || ''), externalTimeoutMs: Number(b.ai_external_timeout_ms), fallbackEnabled: b.ai_fallback_enabled === 'on' }), getTenantId(c))
  const externalKey = String(b.external_ai_api_key || '').trim()
  if (externalKey) await saveSystemSecret(c.env, 'EXTERNAL_AI_API_KEY', externalKey)

  // Web 搜索增强需要模型支持 tools 字段，校验所选模型是否在支持列表中
  const webSearchEnabled = b.ai_web_search_enabled === 'on'
  if (webSearchEnabled) {
    const webSearchModels = ['@cf/meta/llama-3.1-8b-instruct-fast', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/meta/llama-3.1-8b-instruct-fp8']
    const model = String(b.ai_model || '')
    if (!webSearchModels.includes(model)) {
      c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
      return c.redirect('/admin/ai-settings?error=' + encodeURIComponent('该模型不支持联网增强，请换用支持 web_search 的模型（如 Llama 3.1 8B Fast、Llama 3.3 70B Fast、Llama 4 Scout 17B）。'))
    }
  }

  // AI 通道保存后，若已启用，自动基于当前站点画像生成行业化提示词（全部任务）
  const aiSettings = await getAiSettings(c.env, getTenantId(c))
  let industryPromptResult = ''
  if (aiSettings.enabled) {
    try {
      const generated = await generateIndustryPromptsForSite(c.env, getTenantId(c), aiSettings)
      industryPromptResult = generated.ok
        ? '&industry_prompt=ok&industry_prompt_count=' + generated.count
        : '&industry_prompt=error&industry_prompt_error=' + encodeURIComponent((generated.error || '未知错误').slice(0, 300))
    } catch (e) {
      industryPromptResult = '&industry_prompt=error&industry_prompt_error=' + encodeURIComponent(String((e as any)?.message || e).slice(0, 300))
    }
  }

  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/ai-settings?saved=1' + industryPromptResult)
})

adminSettingsRoutes.post('/ai-settings/test', async (c) => {
  const settings = await getAiSettings(c.env, getTenantId(c))
  const body = await c.req.parseBody()
  const task = ['connectivity', 'city', 'article'].includes(String(body.test_task || 'connectivity')) ? String(body.test_task || 'connectivity') : 'connectivity'
  if (!settings.enabled) return c.redirect('/admin/ai-settings?test=disabled&task=' + encodeURIComponent(task))
  try { let responseText = '', quality = ''; if (task === 'connectivity') { const result: any = await runConfiguredAi(c.env, { messages: [{ role: 'user', content: '只回复 ok，不要输出其他内容。' }] }, settings); responseText = getAiResponseText(result).trim(); if (!responseText) return c.redirect('/admin/ai-settings?test=empty&task=connectivity'); quality = '通道可调用，返回文本正常' } else { const generated = await generateAiPageContent(c.env, getTenantId(c), task === 'city' ? { type: 'city', city: '示例城市', keywords: ['示例主题'], summary: '用于后台诊断的示例城市页面。' } : { type: 'article', title: '示例行业文章', summary: '用于后台诊断的示例文章。', keywords: ['示例主题'] }, settings); if (!generated?.content || generated.content.length < 300) throw new Error('真实内容任务返回内容过短或为空'); responseText = [generated.title, generated.summary, generated.content].filter(Boolean).join('\n\n'); quality = '真实内容任务通过：已得到可保存的标题、摘要和正文' } const model = settings.provider === 'workers_ai' ? settings.model : settings.externalModel; return c.redirect('/admin/ai-settings?test=ok&task=' + encodeURIComponent(task) + '&quality=' + encodeURIComponent(quality) + '&provider=' + encodeURIComponent(settings.provider) + '&model=' + encodeURIComponent(model) + '&response=' + encodeURIComponent(responseText.slice(0, 2400))) } catch (e) { safeError('AI diagnostic test failed', e); return c.redirect('/admin/ai-settings?test=error&task=' + encodeURIComponent(task) + '&message=' + encodeURIComponent(errorMessage(e, 'AI 测试失败').slice(0, 600))) }
})

// ---- AI 提示词管理 ----
// 提示词和模型参数一样保存在现有 D1 settings 表，不新增 migration。
adminSettingsRoutes.get('/ai-prompts', async (c) => {
  const settings = await getAiPromptSettings(c.env, getTenantId(c))
  const siteSettings = await loadSiteProfileSettings(c.env, getTenantId(c))
  const profile = getSiteProfile(siteSettings, c.env.SITE_NAME || '')
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""
  return c.html(renderAiPromptsPage(settings, c.req.query('saved') || '', {
    status: c.req.query('test') || '',
    key: c.req.query('testKey') || '',
    provider: c.req.query('provider') || '',
    model: c.req.query('model') || '',
    response: c.req.query('response') || '',
    error: c.req.query('error') || '',
    genKey: c.req.query('gen') || '',
    genText: c.req.query('genText') || '',
    genCount: Number(c.req.query('genCount') || 0),
  }, profile, siteName, cspNonce))
})

adminSettingsRoutes.post('/ai-prompts/save', async (c) => {
  const b = await c.req.parseBody()
  const key = String(b.prompt_key || '')
  if (!AI_PROMPT_TASK_KEYS.includes(key as typeof AI_PROMPT_TASK_KEYS[number])) return c.text('无效的提示词类型', 400)

  const value = String(b.prompt || '')
  const check = validateAiPromptVariables(key as typeof AI_PROMPT_TASK_KEYS[number], value)
  if (check.unknown.length) {
    return c.redirect('/admin/ai-prompts?error=' + encodeURIComponent(
      AI_PROMPT_SPECS[key as keyof typeof AI_PROMPT_SPECS].title + '存在未知变量：' + check.unknown.join('、') + '。请使用页面列出的变量。',
    ))
  }
  await saveAiPromptSettings(c.env, { [key]: value } as any, getTenantId(c))
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/ai-prompts?saved=' + encodeURIComponent(key))
})

adminSettingsRoutes.post('/ai-prompts/test', async (c) => {
  const b = await c.req.parseBody()
  const key = String(b.prompt_key || '')
  if (!AI_PROMPT_TASK_KEYS.includes(key as typeof AI_PROMPT_TASK_KEYS[number])) return c.text('无效的提示词类型', 400)

  const settings = await getAiSettings(c.env, getTenantId(c))
  if (!settings.enabled) {
    return c.redirect('/admin/ai-prompts?test=disabled&testKey=' + encodeURIComponent(key))
  }
  try {
    const routeStatus = await getAiRouteStatus(c.env, getTenantId(c))
    if (!routeStatus.ok) {
      return c.redirect('/admin/ai-prompts?test=error&testKey=' + encodeURIComponent(key) + '&error=' + encodeURIComponent(routeStatus.message))
    }

    const spec = AI_PROMPT_SPECS[key as keyof typeof AI_PROMPT_SPECS]
    const promptSettings = await getAiPromptSettings(c.env, getTenantId(c))
    const prompt = await composeAiPromptWithSystemContacts(
      c.env,
      getTenantId(c),
      promptSettings,
      key === 'global' ? null : key as 'news' | 'city' | 'service' | 'article' | 'keyword' | 'landing' | 'page',
      spec.sampleVariables,
      routeStatus.settings,
    )
    const testInstruction = '\n\n<TEST_INSTRUCTION>这是提示词管理后台的测试，不要写入数据库。严格按照当前任务要求输出；只返回最终内容，不要解释提示词。</TEST_INSTRUCTION>'
    const result: any = await runConfiguredAi(
      c.env,
      { messages: [{ role: 'user', content: prompt + testInstruction }] },
      { ...settings, maxTokens: Math.max(settings.maxTokens, key === 'keyword' ? 1024 : 3072) },
    )
    const responseText = getAiResponseText(result).trim()
    if (!responseText) throw new Error('Workers AI 返回了空文本')
    const model = routeStatus.settings.provider === 'workers_ai' ? routeStatus.settings.model : routeStatus.settings.externalModel
    return c.redirect(
      '/admin/ai-prompts?test=ok&testKey=' + encodeURIComponent(key) +
      '&provider=' + encodeURIComponent(routeStatus.settings.provider) +
      '&model=' + encodeURIComponent(model) +
      '&response=' + encodeURIComponent(responseText.slice(0, 2400)),
    )
  } catch (e) {
    safeError('AI prompt test failed', e)
    return c.redirect(
      '/admin/ai-prompts?test=error&testKey=' + encodeURIComponent(key) +
      '&error=' + encodeURIComponent(errorMessage(e, '提示词测试失败').slice(0, 600)),
    )
  }
})

adminSettingsRoutes.post('/ai-prompts/reset', async (c) => {
  const b = await c.req.parseBody()
  const key = String(b.prompt_key || '')
  if (!AI_PROMPT_TASK_KEYS.includes(key as typeof AI_PROMPT_TASK_KEYS[number])) return c.text('无效的提示词类型', 400)

  await saveAiPromptSettings(c.env, { [key]: '' } as any, getTenantId(c))
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/ai-prompts?saved=' + encodeURIComponent(key + '-reset'))
})

// 按当前行业画像为指定任务类型生成一段"行业化"补充提示词，回填到输入框（不自动保存）
adminSettingsRoutes.post('/ai-prompts/generate-for-industry', async (c) => {
  const b = await c.req.parseBody()
  const key = String(b.prompt_key || 'global')
  const industryPresetId = String(b.industry_preset_id || '').trim()
  // 'all' = 统一识别：一次调用生成全部任务的行业化提示词，避免逐个点 8 次。
  const isAll = key === 'all'
  if (!isAll && !AI_PROMPT_TASK_KEYS.includes(key as typeof AI_PROMPT_TASK_KEYS[number])) return c.text('无效的提示词类型', 400)
  try {
    const aiSettings = await getAiSettings(c.env, getTenantId(c))
    if (!aiSettings.enabled) {
      return c.redirect('/admin/ai-prompts?error=' + encodeURIComponent('AI 功能当前已停用，请先在 AI 设置中启用。'))
    }
    if (isAll) {
      const generated = await generateIndustryPromptsForSite(c.env, getTenantId(c), aiSettings, industryPresetId || undefined)
      if (!generated.ok) return c.redirect('/admin/ai-prompts?error=' + encodeURIComponent('行业化提示词生成失败：' + (generated.error || '未知错误')))
      return c.redirect('/admin/ai-prompts?saved=all&genCount=' + generated.count)
    }

    const spec = AI_PROMPT_SPECS[key as keyof typeof AI_PROMPT_SPECS]
    const settings = await readSettingsMap(c.env, getTenantId(c))

    // 如果指定了预设，优先使用预设的行业配置（确保随模板切换而变化）
    let presetIndustry = ''
    let presetKeywords = ''
    let presetServices = ''
    let presetTargetCustomers = ''
    let presetScenarios = ''
    let presetLabel = ''
    if (industryPresetId) {
      const preset = INDUSTRY_PRESETS.find((p) => p.id === industryPresetId) || await loadPresetFromDb(c.env, getTenantId(c), industryPresetId)
      if (preset) {
        presetLabel = preset.label
        presetIndustry = preset.industry
        presetKeywords = preset.industryKeywords || ''
        presetServices = preset.primaryServices || ''
        presetTargetCustomers = preset.targetCustomers || ''
        presetScenarios = preset.applicationScenarios || ''
      }
    }
    // 未选预设时，回落到 settings 表
    if (!presetIndustry) {
      presetIndustry = String(settings.site_industry || settings.industry_type || '').trim()
      presetLabel = String(settings.site_profile_name || '').trim()
      presetKeywords = String(settings.industry_keywords || '').trim()
      presetServices = String(settings.primary_services || '').trim()
      presetTargetCustomers = String(settings.target_customers || '').trim()
      presetScenarios = String(settings.application_scenarios || '').trim()
    }

    const siteName = settings.site_name || c.env.SITE_NAME || '网站内容平台'

    const profile = `当前网站：${siteName}，行业：${presetIndustry || '未指定'}，行业关键词：${presetKeywords || '未指定'}，目标客户：${presetTargetCustomers || '未指定'}，服务特色：${presetServices || '未指定'}，应用场景：${presetScenarios || '未指定'}。`

    const webSearchEnabled = aiSettings.provider === 'openai_compatible' && aiSettings.webSearchEnabled
    const webSearchInstruction = webSearchEnabled
      ? '先检索该行业最新业务内容再校准，确保提示词与当前行业实际场景一致。'
      : '基于给定行业画像生成，不要编造与该行业无关的内容。'

    const metaPrompt = `你是一名 SEO 与行业内容专家。${profile}
${webSearchInstruction}
任务类型：${spec.title}（${spec.purpose}）。
请基于上述行业画像，生成一段不超过 300 字的"行业化补充提示词"，用于叠加在该任务的默认提示词之后。要求：
1. 聚焦该行业/该任务的具体输出风格、术语、读者、结构；
2. 只写"补充规则"，不重复通用 SEO 底线；
3. 可直接作为提示词片段使用，不要解释。`
    const result = await runConfiguredAi(c.env, { messages: [{ role: 'user', content: metaPrompt }] }, aiSettings)
    const generated = getAiResponseText(result).trim().slice(0, 2400)
    if (!generated) throw new Error('AI 未返回可用提示词，请先完善站点行业画像再试')
    return c.redirect('/admin/ai-prompts?gen=' + encodeURIComponent(key) + '&genText=' + encodeURIComponent(generated))
  } catch (e) {
    safeError('generate-for-industry prompt failed', e)
    return c.redirect('/admin/ai-prompts?error=' + encodeURIComponent('行业化提示词生成失败：' + String((e as any)?.message || e).slice(0, 300)))
  }
})

adminSettingsRoutes.post('/settings/generate-industry-keywords', async (c) => {
  try {
    const b = await c.req.parseBody()
    const savedSettings = await readSettingsMap(c.env, getTenantId(c))
    // 该按钮位于“白标行业/站点画像”表单内。优先使用本次表单提交的值，
    // 这样用户刚填写行业/主题/服务但尚未单独点击“保存”时，AI 也能基于最新输入生成关键词。
    const settings: Record<string, string> = {
      ...savedSettings,
      site_name: String(b.site_name || savedSettings.site_name || '').trim(),
      site_topic: String(b.site_topic || savedSettings.site_topic || '').trim(),
      site_industry: String(b.site_industry || savedSettings.site_industry || '').trim(),
      primary_services: String(b.primary_services || savedSettings.primary_services || '').trim(),
      primary_keywords: String(b.primary_keywords || savedSettings.primary_keywords || '').trim(),
      industry_keywords: String(b.industry_keywords || savedSettings.industry_keywords || '').trim(),
      news_categories: String(b.news_categories || savedSettings.news_categories || '').trim(),
    }
    // AI 生成依赖行业画像；本次表单输入也应同步保存，避免生成结果建立在未持久化的画像上。
    const profileKeys = ['site_name', 'site_topic', 'site_industry', 'primary_services', 'primary_keywords', 'industry_keywords', 'news_categories']
    for (const key of profileKeys) {
      await saveSetting(c.env, key, String(settings[key] || ''), getTenantId(c))
    }
    const aiSettings = await getAiSettings(c.env, getTenantId(c))
    if (!aiSettings.enabled) return c.redirect('/admin/settings?error=' + encodeURIComponent('AI 功能当前已停用，请先在 AI 设置中启用。'))
    const promptSettings = await getAiPromptSettings(c.env, getTenantId(c))

    // 联网增强：仅在第三方 OpenAI-compatible 通道且用户勾选“启用联网增强”时注入联网要求
    const webSearchEnabled = aiSettings.provider === 'openai_compatible' && aiSettings.webSearchEnabled
    const webSearchInstruction = webSearchEnabled
      ? '先检索该行业最新业务内容再校准，确保关键词与当前行业实际场景一致。'
      : '基于给定行业画像生成，不要编造与该行业无关的内容。'

    const articleRows = (await c.env.DB.prepare("SELECT title, summary, content FROM articles WHERE status='published' AND tenant_id=? ORDER BY published_at DESC, id DESC LIMIT 8").bind(getTenantId(c)).all()).results as any[]
    const serviceRows = (await c.env.DB.prepare("SELECT name, summary FROM services WHERE is_active=1 AND tenant_id=? ORDER BY sort_order, id LIMIT 20").bind(getTenantId(c)).all()).results as any[]
    const contentEvidence = [
      ...articleRows.map((row) => [row.title, row.summary, String(row.content || '').replace(/<[^>]+>/g, ' ').slice(0, 700)].filter(Boolean).join('：')),
      ...serviceRows.map((row) => [row.name, row.summary].filter(Boolean).join('：')),
    ].join('\n').slice(0, 9000)
    const prompt = await composeAiPromptWithSystemContacts(c.env, getTenantId(c), promptSettings, 'keyword', {
      siteName: settings.site_name || c.env.SITE_NAME || '网站内容平台',
      subject: settings.site_topic || settings.site_industry || '',
      keywords: [settings.primary_keywords || '', settings.industry_keywords || ''].filter(Boolean).join('、'),
      services: settings.primary_services || '',
      target_customers: settings.target_customers || '',
      application_scenarios: settings.application_scenarios || '',
      sourceContent: contentEvidence,
      task: '根据当前站点名称、主题、行业、目标客户、核心服务、服务特色、应用场景、已有主题词以及已发布文章/服务的真实内容，自动识别行业高频主题、业务场景、用户问题和核心实体词；去除无关词、品牌词、同义重复词。只返回可由站点公开内容证明的关键词候选。\n\n要求：' + webSearchInstruction,
    }, aiSettings)
    const result = await runConfiguredAi(c.env, { messages: [{ role: 'user', content: prompt }] }, aiSettings)
    const parsed = parseAiJson(getAiResponseText(result).trim()) as any
    const candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.keywords) ? parsed.keywords : []
    const merged = normalizeKeywordCandidates([...String(settings.industry_keywords || '').split(/[,，;；\n、]+/), ...candidates], 30)
    if (!merged.length) throw new Error('AI没有返回可用行业关键词，请先填写站点行业、主题或核心服务。')
    await saveSetting(c.env, 'industry_keywords', merged.join(','), getTenantId(c))
    // 行业关键词属于全站 AI/SEO 上下文；生成后立即同步页面级 SEO 词，不要求用户再手动执行一次 SEO 操作。
    await syncPageSeoKeywords(c.env, getTenantId(c))
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    return c.redirect('/admin/settings?saved=1&ai=industry-keywords')
  } catch (e) {
    safeError('generate industry keywords failed', e)
    return c.redirect('/admin/settings?error=' + encodeURIComponent('AI行业关键词生成失败：' + errorMessage(e, '未知错误').slice(0, 500)))
  }
})

// AI 生成行业关键词（供“行业与业务配置”区块前端调用，返回 JSON）
adminSettingsRoutes.post('/settings/industry-keywords/ai', async (c) => {
  try {
    const b = await c.req.parseBody()
    const tenantId = getTenantId(c)
    const industryPresetId = String(b.industry_preset_id || '').trim()
    const rawSeeds = b['seed_keywords[]'] ?? b.seed_keywords ?? []
    const seedKeywords = Array.isArray(rawSeeds)
      ? rawSeeds.map(String).filter(Boolean).slice(0, 5)
      : [String(rawSeeds)].filter(Boolean).slice(0, 5)

    // 读取当前行业预设配置（内置预设或 D1 自定义预设）
    let presetLabel = ''
    let presetIndustry = ''
    let presetKeywords = ''
    let presetServices = ''
    let presetScenarios = ''
    let presetTargetCustomers = ''
    if (industryPresetId) {
      const preset = INDUSTRY_PRESETS.find((p) => p.id === industryPresetId) || await loadPresetFromDb(c.env, tenantId, industryPresetId)
      if (preset) {
        presetLabel = preset.label
        presetIndustry = preset.industry
        presetKeywords = preset.industryKeywords || ''
        presetServices = preset.primaryServices || ''
        presetScenarios = preset.applicationScenarios || ''
        presetTargetCustomers = preset.targetCustomers || ''
      }
    }
    // 未选预设时，回落到 settings 表里的当前行业配置（兜底生成，不因下拉为空而拒绝）
    if (!presetIndustry) {
      const settings = await readSettingsMap(c.env, tenantId)
      presetIndustry = String(settings.site_industry || settings.industry_type || '').trim()
      presetLabel = String(settings.site_profile_name || '').trim()
      presetKeywords = String(settings.industry_keywords || '').trim()
      presetServices = String(settings.primary_services || '').trim()
      presetScenarios = String(settings.application_scenarios || '').trim()
      presetTargetCustomers = String(settings.target_customers || '').trim()
    }

    // AI 通道未配置或未启用时返回 400
    const aiSettings = await getAiSettings(c.env, tenantId)
    if (!aiSettings.enabled) {
      return c.json({ message: 'AI 通道未配置或未启用' }, 400)
    }

    const industryContext = [
      presetLabel ? '行业画像：' + presetLabel : '',
      presetIndustry ? '所属行业：' + presetIndustry : '',
      presetTargetCustomers ? '目标客户：' + presetTargetCustomers : '',
      presetKeywords ? '行业关键词：' + presetKeywords : '',
      presetServices ? '服务特色：' + presetServices : '',
      presetScenarios ? '应用场景：' + presetScenarios : '',
    ].filter(Boolean).join('；')

    const coreWords = [presetKeywords, presetServices].join('；').split(/[,，;；、\s]+/).filter(Boolean).slice(0, 8)

    // 联网增强：仅在第三方 OpenAI-compatible 通道且用户勾选“启用联网增强”时注入联网要求
    const webSearchEnabled = aiSettings.provider === 'openai_compatible' && aiSettings.webSearchEnabled
    const webSearchInstruction = webSearchEnabled
      ? '先检索该行业最新业务内容再校准，确保关键词与当前行业实际场景一致。'
      : '基于给定行业画像生成，不要编造与该行业无关的内容。'

    let keywords: string[] = []
    let keywordsReviewed = false
    for (let attempt = 1; attempt <= 2; attempt++) {
      const prompt = '基于以下行业画像生成 10-15 个相关的行业关键词，逗号分隔返回，只输出关键词列表，不要解释。\n\n' + industryContext + '\n\n种子关键词：' + (seedKeywords.join(', ') || '(无)') + '\n\n要求：' + webSearchInstruction
      const result = await runConfiguredAi(c.env, { messages: [{ role: 'user', content: prompt }] }, aiSettings)
      const text = getAiResponseText(result).trim()
      keywords = text.split(/[,，;；、\n]+/).map((s) => s.trim()).filter(Boolean)
      if (keywords.length) {
        // 一致性校验：生成的关键词应包含至少一个行业核心词（若有核心词时）
        if (!coreWords.length || keywords.some((k) => coreWords.some((cw) => k.includes(cw) || cw.includes(k)))) break
        keywordsReviewed = true
        if (attempt === 2) break
        // 不满足则重新生成一次
      } else if (attempt === 2) {
        break
      }
    }

    if (!keywords.length) throw new Error('AI 未返回可用行业关键词')

    return c.json({ keywords: keywords.slice(0, 15), needsReview: keywordsReviewed })
  } catch (e) {
    safeError('generate industry keywords ai failed', e)
    const msg = String((e as any)?.message || e)
    if (msg.indexOf('未配置') >= 0 || msg.indexOf('未启用') >= 0) {
      return c.json({ message: 'AI 通道未配置或未启用' }, 400)
    }
    return c.json({ message: 'AI 生成行业关键词失败：' + msg.slice(0, 300) }, 500)
  }
})

/** 应用行业配置：保存行业画像、生成关键词矩阵、同步页面 SEO、批量插入城市/服务。
 * 可被 /admin/setup 和 /admin/settings/industry-config 共用。 */
export async function applyIndustryConfig(
  env: Bindings,
  tenantId: number,
  b: Record<string, unknown>,
): Promise<{
  matrixChanged: number
  seoPagesSynced: number
  citiesInserted: number
  servicesInserted: number
  matrixOk: boolean
}> {
  const fields: Record<string, number> = {
    industry_type: 80,
    industry_keywords: 1600,
    target_customers: 300,
    service_features: 500,
    application_scenarios: 500,
  }
  const updates: Record<string, string> = {}
  for (const [key, max] of Object.entries(fields)) {
    const value = String((b as any)[key] ?? '').trim().slice(0, max)
    updates[key] = value
  }
  if (Object.keys(updates).length) {
    await SettingsStore.forTenant(env, tenantId).batch(Object.entries(updates))
  }

  // 行业配置全站自动应用：重新生成城市×服务关键词矩阵，并同步页面级 SEO 关键词
  let matrixChanged = 0
  let seoPagesSynced = 0
  let matrixOk = true
  try {
    matrixChanged = await generateKeywordMatrix(env)
    const synced = await syncPageSeoKeywords(env, tenantId)
    seoPagesSynced = synced.cities + synced.services + synced.articles
  } catch (e) {
    safeError('industry-config auto-apply failed', e)
    matrixOk = false
  }

  // 根据 industry_type 从预设读取城市与服务，批量插入（幂等：仅在不存在时插入）
  let citiesInserted = 0
  let servicesInserted = 0
  try {
    const presetId = String(b.industry_type || '').trim()
    if (presetId) {
      const preset = getIndustryPreset(presetId)
      if (preset) {
        // 1. 先插入城市（城市必须先于服务，因为关键词矩阵会关联 city_id）
        const cityNames = preset.cities.split(',').map((s: string) => s.trim()).filter(Boolean)
        for (const name of cityNames) {
          const slug = String(name || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60)
          if (!slug) continue
          const exists = await env.DB.prepare('SELECT id FROM cities WHERE tenant_id=? AND (name=? OR slug=?) LIMIT 1').bind(tenantId, name, slug).first()
          if (!exists) {
            await env.DB.prepare('INSERT INTO cities (name, slug, province, tier, tenant_id, is_active, sort_order) VALUES (?, ?, ?, ?, ?, 1, COALESCE(MAX(sort_order),0)+1 FROM cities WHERE tenant_id = ?)').bind(name, slug, '', '二线', tenantId, tenantId).run()
            citiesInserted++
          }
        }
        // 2. 再插入服务
        const serviceNames = preset.primaryServices.split(',').map((s: string) => s.trim()).filter(Boolean)
        for (const name of serviceNames) {
          const slug = String(name || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60)
          if (!slug) continue
          const exists = await env.DB.prepare('SELECT id FROM services WHERE tenant_id=? AND (name=? OR slug=?) LIMIT 1').bind(tenantId, name, slug).first()
          if (!exists) {
            await env.DB.prepare('INSERT INTO services (name, slug, summary, tenant_id, is_active, sort_order, seo_title, seo_description, seo_keywords, demand_weight) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 50)')
              .bind(name, slug, '', tenantId, citiesInserted + servicesInserted + 1, name, '', '')
              .run()
            servicesInserted++
          }
        }
      }
    }
  } catch (e) {
    safeError('industry-config batch insert failed', e)
  }

  return { matrixChanged, seoPagesSynced, citiesInserted, servicesInserted, matrixOk }
}

adminSettingsRoutes.post('/settings/industry-config', async (c) => {
  const b = await c.req.parseBody() as Record<string, unknown>
  const result = await applyIndustryConfig(c.env, getTenantId(c), b)
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/settings?saved=1&ai=industry-config&matrix=' + result.matrixChanged + '&seo=' + result.seoPagesSynced + '&cities=' + result.citiesInserted + '&services=' + result.servicesInserted + '&matrix_ok=' + (result.matrixOk ? '1' : '0'))
})

// ---- 行业预设管理（CRUD）----
// 列出全部预设（内置 + 自定义），供前台下拉框渲染
adminSettingsRoutes.get('/settings/presets', async (c) => {
  const tenantId = getTenantId(c)
  const builtIn = INDUSTRY_PRESETS.map((p) => ({ id: p.id, label: p.label, is_built_in: true }))
  const custom = await listPresetsFromDb(c.env, tenantId)
  return c.json({ presets: [...builtIn, ...custom] })
})

// 保存为自定义预设：将当前表单值写入 D1 preset_templates
adminSettingsRoutes.post('/settings/presets', async (c) => {
  const b = await c.req.parseBody()
  const presetId = String(b.id || '').trim()
  const name = String(b.name || '').trim()
  const topic = String(b.topic || '').trim()
  const industry = String(b.industry || '').trim()
  const description = String(b.description || '').trim()
  const targetCustomers = String(b.target_customers || '').trim()
  const serviceFeatures = String(b.service_features || '').trim()
  const applicationScenarios = String(b.application_scenarios || '').trim()
  const cities = String(b.cities || '').trim()
  const primaryServices = String(b.primary_services || '').trim()
  const primaryKeywords = String(b.primary_keywords || '').trim()
  const industryKeywords = String(b.industry_keywords || '').trim()
  const newsCategories = String(b.news_categories || '').trim()

  if (!presetId || !name) {
    return c.redirect('/admin/settings?error=' + encodeURIComponent('预设 ID 与名称必填'))
  }

  await savePresetToDb(c.env, getTenantId(c), presetId, {
    id: presetId,
    label: name,
    topic,
    industry,
    description,
    targetCustomers,
    serviceFeatures,
    applicationScenarios,
    cities,
    primaryServices,
    primaryKeywords,
    industryKeywords,
    newsCategories,
  })
  c.executionCtx.waitUntil(purgeCacheAll(c.env))
  return c.redirect('/admin/settings?saved=1&preset_saved=1&preset_id=' + encodeURIComponent(presetId))
})

// 删除自定义预设（内置预设不可删除，下次部署会重新写入）
adminSettingsRoutes.post('/settings/presets/:id/delete', async (c) => {
  const presetId = c.req.param('id')
  if (!presetId) {
    return c.redirect('/admin/settings?error=' + encodeURIComponent('预设 ID 缺失'))
  }
  // 只允许删除自定义预设
  if (INDUSTRY_PRESETS.some((p) => p.id === presetId)) {
    return c.redirect('/admin/settings?error=' + encodeURIComponent('内置预设不可删除，下次部署会重新写入'))
  }
  await deletePresetFromDb(c.env, getTenantId(c), presetId)
  c.executionCtx.waitUntil(purgeCacheAll(c.env))
  return c.redirect('/admin/settings?saved=1&preset_deleted=1&preset_id=' + encodeURIComponent(presetId))
})

// 加载预设内容到编辑器（返回 JSON，供前台填充表单）
adminSettingsRoutes.get('/settings/presets/:id', async (c) => {
  const tenantId = getTenantId(c)
  const presetId = c.req.param('id')
  if (!presetId) {
    return c.redirect('/admin/settings?error=' + encodeURIComponent('预设 ID 缺失'))
  }
  const preset = INDUSTRY_PRESETS.find((p) => p.id === presetId) || await loadPresetFromDb(c.env, tenantId, presetId)
  if (!preset) {
    return c.redirect('/admin/settings?error=' + encodeURIComponent('预设不存在'))
  }
  return c.json(preset)
})