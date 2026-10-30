import { safeError, safeWarn } from '../../utils/safeLogger'
import type { Bindings, Variables } from '../../types'
import { SettingsStore } from '../../utils/settingsStore'
import { getTenantId } from '../../db/scoped'
import { getSiteProfile } from '../../utils/siteProfile'
import { getPageSettings, serializePageSettings, isManagedPageKey } from '../../utils/pageSettings'
import { getAiContentStore, saveAiContentStore, aiContentSettingKey } from '../../utils/aiContentStore'
import { getContactMethods } from '../../utils/contactSettings'
import { getCookieFromString, getJwtSecret, verifyToken } from '../../utils/auth'
import {
  autoCitySeo, autoServiceSeo, autoArticleSeo, buildArticleSeoKeywords,
  normalizeSeoKeywords, normalizeKeywordCandidates, alignSeoKeywordsToContent,
} from '../../utils/autoSeo'
import { generateAiPageContent } from '../../utils/aiPageContent'
import { getAiSettings } from '../../utils/aiSettings'
import { auditSeoPage, summarizeSeoAudit, type SeoAuditPage, type SeoAuditResult } from '../../utils/seoAudit'
import {
  MIN_INDEXABLE_OPPORTUNITY_SCORE, isKeywordRelevantToSite,
} from '../../utils/keywordScore'
import { getGlobalSeoKeywords as getProfileGlobalSeoKeywords } from '../../utils/siteProfile'
import { purgeCacheAll, purgeCacheTags, mediaCacheTag } from '../../middleware/cache'
import { getServiceExternalLinks } from '../../utils/serviceSettings'
import { escapeHtml } from '../../templates/layout'

export type SeoGeneratedPageStats = {
  keywordCleanup: number
  duplicateKeywords: number
  duplicateKeywordGroups: number
  generatedCities: number
  generatedServices: number
  generatedLandings: number
  sitemapLandings: number
  publishedAiArticles: number
  generatedAiArticles: number
  lowScorePublishedAiArticles: number
  invalidCities: number
  invalidServices: number
  invalidLandings: number
  invalidTotal: number
  invalidDirectKeys: string[]
  legacyInvalid: { cities: string[]; services: string[]; landing: string[] }
}

export type SeoAuditView = SeoAuditPage & { audit: SeoAuditResult; dbId?: number }

export function getTenantIdFromRequest(c: any): number {
  return getTenantId(c)
}

export async function readSettingsMap(env: Bindings, tenantId?: number): Promise<Record<string, string>> {
  const store = tenantId != null ? SettingsStore.forTenant(env, tenantId) : SettingsStore.for(env)
  return store.getMap('all')
}

export async function saveSetting(env: Bindings, key: string, value: string, tenantId?: number) {
  const store = tenantId != null ? SettingsStore.forTenant(env, tenantId) : SettingsStore.for(env)
  await store.set(key, value)
}

export async function getGlobalSeoKeywords(env: Bindings, tenantId = 1): Promise<string> {
  const profile = getSiteProfile(await readSettingsMap(env, tenantId), env.SITE_NAME || '')
  return getProfileGlobalSeoKeywords(profile, 20).join(',')
}

export function getKeywordList(value = ''): string[] {
  return normalizeKeywordCandidates(value, 15)
}

export function getArticleAiKeywords(title: string, summary = ''): string[] {
  return buildArticleSeoKeywords(title, summary)
}

export async function getAiRouteStatus(env: Bindings, tenantId: number = 1): Promise<{ ok: true; settings: Awaited<ReturnType<typeof getAiSettings>> } | { ok: false; message: string }> {
  const settings = await getAiSettings(env, tenantId)
  if (!settings.enabled) {
    return { ok: false, message: 'AI 内容生成当前已关闭：请进入「AI设置」开启 AI 内容生成并保存。' }
  }
  if (settings.provider === 'workers_ai') {
    if (!env.AI || typeof (env.AI as any).run !== 'function') {
      return { ok: false, message: '当前通道为 Workers AI，但 Binding “AI” 未生效：请在 Cloudflare Worker → Settings → Bindings 检查 AI 绑定并重新部署。' }
    }
  } else {
    if (!(await env.CACHE_KV?.get('__cms_jwt_secret')) && !String(env.EXTERNAL_AI_API_KEY || '').trim()) {
      return { ok: false, message: '当前通道为外部 OpenAI-compatible API，但 API Key 未配置。请进入后台「AI设置」填写；也可使用 Cloudflare Secret EXTERNAL_AI_API_KEY 作为兼容兜底。' }
    }
    if (!settings.externalBaseUrl) {
      return { ok: false, message: '外部 AI API 地址未配置或不是 HTTPS 公网地址，请到「AI设置」填写 API Base URL。' }
    }
    if (!settings.externalModel) {
      return { ok: false, message: '外部 AI 模型名称未配置，请到「AI设置」填写模型名称。' }
    }
  }
  return { ok: true, settings }
}

export function aiEmptyResultMessage(task: string, settings: Awaited<ReturnType<typeof getAiSettings>>): string {
  const providerLabel = settings.provider === 'workers_ai' ? 'Workers AI' : '外部 OpenAI-compatible API'
  const model = settings.provider === 'workers_ai' ? settings.model : settings.externalModel
  return task + '已调用' + providerLabel + '，但没有得到可保存的有效内容。当前模型：' + model + '。AI 连通性测试成功只代表模型能返回文本；页面生成还需要符合当前任务的 JSON/HTML 结构和长度要求。请在「AI提示词」检查对应任务是否被改得过短或改成了其他输出格式。'
}

export async function getCityAiKeywords(env: Bindings, tenantId: number, cityId: number, cityName: string, globalKeywords = ''): Promise<string[]> {
  const rows = (await env.DB.prepare(
    'SELECT keyword FROM keywords WHERE city_id=? AND COALESCE(opportunity_score,0)>0 ORDER BY opportunity_score DESC, search_volume DESC, id ASC LIMIT 5'
  ).bind(cityId).all()).results as any[]
  const discovered = rows.map((row) => String(row.keyword || '').trim()).filter(Boolean)
  const siteTopics = normalizeKeywordCandidates(globalKeywords, 20)
  const profile = getSiteProfile(await readSettingsMap(env, tenantId), env.SITE_NAME || '')
  const fallback = [cityName + profile.topic, cityName + '服务', cityName + '流程', cityName + '注意事项']
  return normalizeSeoKeywords([...fallback, ...discovered, ...siteTopics.map((keyword) => cityName + keyword)], 5)
}

export async function getServiceAiKeywords(env: Bindings, tenantId: number, serviceId: number, serviceName: string, globalKeywords = ''): Promise<string[]> {
  const rows = (await env.DB.prepare(
    'SELECT keyword FROM keywords WHERE service_id=? AND COALESCE(opportunity_score,0)>0 ORDER BY opportunity_score DESC, search_volume DESC, id ASC LIMIT 5'
  ).bind(serviceId).all()).results as any[]
  const discovered = rows.map((row) => String(row.keyword || '').trim()).filter(Boolean)
  const siteTopics = normalizeKeywordCandidates(globalKeywords, 15)
  const fallback = [serviceName, serviceName + '办理', serviceName + '流程', serviceName + '注意事项']
  const relevantSiteTopics = siteTopics.filter((keyword) => serviceName.includes(keyword) || keyword.includes(serviceName))
  return normalizeSeoKeywords([serviceName, serviceName + '办理', serviceName + '流程', serviceName + '注意事项', ...relevantSiteTopics, ...discovered, ...fallback], 5)
}

export async function buildPublicSeoAudit(env: Bindings, tenantId: number): Promise<{ pages: SeoAuditView[]; summary: ReturnType<typeof summarizeSeoAudit> }> {
  const [settingsMap, cityRows, serviceRows, articleRows, keywordRows, caseRows] = await Promise.all([
    SettingsStore.forTenant(env, tenantId).getMapExcluding(['ai_prompt_']),
    env.DB.prepare("SELECT id, name, slug, is_active, seo_title, seo_description, seo_keywords FROM cities WHERE tenant_id=? ORDER BY id").bind(tenantId).all(),
    env.DB.prepare("SELECT id, name, slug, summary, is_active, seo_title, seo_description, seo_keywords FROM services WHERE tenant_id=? ORDER BY id").bind(tenantId).all(),
    env.DB.prepare("SELECT id, title, slug, summary, content, status, ai_generated, seo_title, seo_description, seo_keywords FROM articles WHERE status='published' AND tenant_id=? ORDER BY published_at DESC, id DESC").bind(tenantId).all(),
    env.DB.prepare(`SELECT k.id, k.keyword, k.city_id, k.service_id, k.opportunity_score, k.landing_slug,
           ci.name AS city_name, ci.slug AS city_slug, ci.is_active AS city_active,
           s.name AS service_name, s.slug AS service_slug, s.is_active AS service_active,
           s.seo_description AS service_seo_description, s.seo_keywords AS service_seo_keywords
         FROM keywords k LEFT JOIN cities ci ON ci.id=k.city_id LEFT JOIN services s ON s.id=k.service_id
         WHERE k.city_id IS NOT NULL AND k.service_id IS NOT NULL ORDER BY k.opportunity_score DESC, k.id ASC`).all(),
    env.DB.prepare("SELECT client_name, industry, service_name, region, summary, is_active FROM cases WHERE tenant_id=? ORDER BY is_featured DESC, sort_order, id").bind(tenantId).all(),
  ])
  const settings = settingsMap
  const pageSettings = getPageSettings(settings)
  const aiStore = getAiContentStore(settings)
  const directAi = new Map<string, any>()
  const aiRows = (await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'ai_page:%'").all()).results as any[]
  for (const row of aiRows) {
    try { const parsed = JSON.parse(String(row.value || '')); if (parsed && typeof parsed.content === 'string') directAi.set(String(row.key), parsed) } catch {}
  }
  const getAi = (group: 'cities' | 'services' | 'landing', key: string) => directAi.get(aiContentSettingKey(group, key)) || aiStore[group]?.[key]
  const pages: SeoAuditView[] = []
  const add = (page: SeoAuditPage, dbId?: number) => pages.push({ ...page, dbId, audit: auditSeoPage(page) })
  const home = pageSettings.home, articlesPage = pageSettings.articles, cityList = pageSettings.cities, serviceList = pageSettings.services, caseList = pageSettings.cases, about = pageSettings.about, contact = pageSettings.contact
  const activeServices = (serviceRows.results as any[]).filter((r) => Number(r.is_active || 0) === 1)
  const activeCities = (cityRows.results as any[]).filter((r) => Number(r.is_active || 0) === 1)
  const publishedArticles = (articleRows.results as any[]).filter((r) => String(r.status || '') === 'published')
  // 案例列表页的可见内容就是这些卡片：客户名、行业、地区、摘要。
  const activeCases = (caseRows.results as any[]).filter((r) => Number(r.is_active || 0) === 1)
  const globalContacts = getContactMethods(settings)
  const visibleManagedContent: Record<string, string> = {
    home: [settings.site_description || '', ...activeServices.slice(0, 8).map((r) => [r.name, r.summary].filter(Boolean).join('：')), ...activeCities.slice(0, 24).map((r) => [r.name, r.province].filter(Boolean).join(' ')), ...activeCases.slice(0, 6).map((r) => [r.client_name, r.industry, r.region, r.summary].filter(Boolean).join('：')), ...publishedArticles.slice(0, 6).map((r) => [r.title, r.summary].filter(Boolean).join('：')), '服务项目、成功案例、服务城市、新闻资讯、需求提交入口'].filter(Boolean).join('；'),
    services: activeServices.map((r) => [r.name, r.summary].filter(Boolean).join('：')).join('；'),
    cases: activeCases.map((r) => [r.client_name, r.industry, r.region, r.summary].filter(Boolean).join('：')).join('；'),
    cities: activeCities.slice(0, 100).map((r) => [r.name, r.province].filter(Boolean).join(' ')).join('；'),
    articles: publishedArticles.map((r) => [r.title, r.summary].filter(Boolean).join('：')).join('；'),
    about: '专业团队；服务范围；执行流程；需求提交入口',
    contact: [globalContacts.phones.length ? '电话：' + globalContacts.phones.join('、') : '', globalContacts.wechats.length ? '微信：' + globalContacts.wechats.join('、') : '', globalContacts.qqs.length ? 'QQ：' + globalContacts.qqs.join('、') : '', '需求提交表单：姓名、电话、城市、服务项目、需求说明'].filter(Boolean).join('；'),
  }
  const managedPages = [
    { page: home, key: 'home', fallbackTitle: '首页', fallbackDesc: settings.site_description || '网站首页内容与服务信息', url: '/' },
    { page: articlesPage, key: 'articles', fallbackTitle: '新闻资讯', fallbackDesc: '行业资讯、实用指南与服务信息', url: '/article' },
    { page: cityList, key: 'cities', fallbackTitle: '服务城市', fallbackDesc: '城市与地区服务信息', url: '/city' },
    { page: serviceList, key: 'services', fallbackTitle: '服务项目', fallbackDesc: '服务范围、执行流程与相关信息', url: '/service' },
    { page: caseList, key: 'cases', fallbackTitle: '成功案例', fallbackDesc: '真实交付的项目、遇到的问题与最终成果', url: '/case' },
    { page: about, key: 'about', fallbackTitle: '关于我们', fallbackDesc: settings.site_description || '站点介绍、服务范围与工作方式', url: '/about' },
    { page: contact, key: 'contact', fallbackTitle: '联系我们', fallbackDesc: '提交需求与联系方式', url: '/contact' },
  ] as const
  for (const item of managedPages) {
    const p: any = item.page
    const title = p.mode === 'internal' ? (item.key === 'home' ? (settings.site_title || p.titleZh || item.fallbackTitle) : (p.titleZh || item.fallbackTitle)) : (p.labelZh || item.fallbackTitle)
    const description = p.mode === 'internal' ? (item.key === 'home' ? (settings.site_description || p.subtitleZh || item.fallbackDesc) : (p.subtitleZh || item.fallbackDesc)) : item.fallbackDesc
    add({ type: item.key === 'home' ? 'home' : 'list', key: item.key, title, url: item.url, description, content: p.mode === 'internal' ? [String(p.contentZh || ''), visibleManagedContent[item.key] || ''].filter(Boolean).join('\n') : '', keywords: String(p.seoKeywordsZh || (item.key === 'home' ? settings.site_keywords || '' : p.labelZh || item.fallbackTitle)), indexable: p.mode === 'internal', sitemap: p.mode === 'internal', active: p.mode === 'internal', aiGenerated: p.aiGenerated === true || (item.key === 'home' && settings.site_seo_ai_generated === '1'), tenantId })
  }
  for (const row of (cityRows.results as any[])) {
    const ai = getAi('cities', String(row.slug || ''))
    add({ type: 'city', key: String(row.slug || row.id), title: String(row.seo_title || row.name + (settings.site_topic || settings.site_industry || '服务信息')), url: '/city/' + String(row.slug || ''), description: String(row.seo_description || ''), content: String(ai?.content || ''), keywords: String(row.seo_keywords || ''), indexable: Number(row.is_active || 0) === 1, sitemap: Number(row.is_active || 0) === 1, active: Number(row.is_active || 0) === 1, aiGenerated: !!ai, tenantId }, Number(row.id || 0))
  }
  const serviceLinks = await loadServiceExternalLinks(env, tenantId)
  for (const row of (serviceRows.results as any[])) {
    const ai = getAi('services', String(row.slug || ''))
    const external = !!serviceLinks[String(row.slug || '')]
    add({ type: 'service', key: String(row.slug || row.id), title: String(row.seo_title || row.name + '服务'), url: '/service/' + String(row.slug || ''), description: String(row.seo_description || row.summary || ''), content: String(ai?.content || ''), keywords: String(row.seo_keywords || row.name || ''), indexable: Number(row.is_active || 0) === 1 && !external, sitemap: Number(row.is_active || 0) === 1 && !external, active: Number(row.is_active || 0) === 1 && !external, aiGenerated: !!ai, tenantId }, Number(row.id || 0))
  }
  for (const row of (articleRows.results as any[])) {
    add({ type: 'article', key: String(row.slug || row.id), title: String(row.seo_title || row.title || ''), url: '/article/' + String(row.slug || ''), description: String(row.seo_description || row.summary || ''), content: String(row.content || ''), keywords: String(row.seo_keywords || ''), indexable: row.status === 'published', sitemap: row.status === 'published', active: row.status === 'published', aiGenerated: Number(row.ai_generated || 0) === 1, tenantId }, Number(row.id || 0))
  }
  for (const row of (keywordRows.results as any[])) {
    const cityActive = Number(row.city_active || 0) === 1, serviceActive = Number(row.service_active || 0) === 1, opportunity = Number(row.opportunity_score || 0)
    const landingKey = String(row.landing_slug || (String(row.city_slug || '') + '-' + String(row.service_slug || '')))
    const ai = getAi('landing', landingKey)
    const siteProfile = getSiteProfile(await readSettingsMap(env, tenantId), env.SITE_NAME || '')
    const isRelevant = isKeywordRelevantToSite(
      String(row.keyword || ''),
      siteProfile,
      String(row.city_name || ''),
      String(row.service_name || ''),
    )
    add({ type: 'landing', key: landingKey, title: String(row.keyword || ''), url: '/city/' + String(row.city_slug || '') + '/' + String(row.service_slug || ''), description: String(ai?.summary || row.service_seo_description || ''), content: String(ai?.content || ''), keywords: String(row.keyword || '') + ',' + String(row.service_seo_keywords || ''), indexable: cityActive && serviceActive && opportunity >= MIN_INDEXABLE_OPPORTUNITY_SCORE && isRelevant, sitemap: cityActive && serviceActive && opportunity >= MIN_INDEXABLE_OPPORTUNITY_SCORE && isRelevant, active: cityActive && serviceActive && opportunity >= MIN_INDEXABLE_OPPORTUNITY_SCORE && isRelevant, aiGenerated: !!ai, opportunityScore: opportunity, tenantId }, Number(row.id || 0))
  }
  const summary = summarizeSeoAudit(pages.map((p) => p.audit))
  return { pages, summary }
}

export async function loadServiceExternalLinks(env: Bindings, tenantId: number): Promise<Record<string, string>> {
  const store = SettingsStore.forTenant(env, tenantId)
  const raw = await store.get('service_external_links', '')
  const { getServiceExternalLinks } = await import('../../utils/serviceSettings')
  return getServiceExternalLinks(raw ? { service_external_links: raw } : {})
}

export async function loadArticleAndCity(env: Bindings, id: string, tenantId: number) {
  const article = await env.DB.prepare('SELECT * FROM articles WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first() as any
  if (!article) return { article: null, cityName: '全国' }
  let cityName = '全国'
  if (article.city_id) {
    const city = await env.DB.prepare('SELECT name FROM cities WHERE id = ? AND tenant_id = ?').bind(article.city_id, tenantId).first() as any
    if (city) cityName = city.name
  }
  return { article, cityName }
}

export function escapeStatus(status: string) {
  return { draft: '草稿', pending_review: '待审核', published: '已发布' }[status] || status
}

export function escapeForPreview(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export function errorMessage(error: unknown, fallback = '未知错误'): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error == null) return fallback
  try { const serialized = JSON.stringify(error); if (serialized && serialized !== '{}') return serialized } catch {}
  const stringified = String(error ?? '').trim()
  return stringified || fallback
}

export async function getCurrentAdmin(c: any) {
  // Hono 4.13 的 HonoRequest 没有 headers 属性（只有 header(name) 方法）
  const cookieHeader = typeof c.req.header === 'function' ? c.req.header('cookie') : c.req.raw?.headers?.get?.('cookie')
  const token = getCookieFromString(cookieHeader, 'admin_session')
  const secret = await getJwtSecret(c.env)
  const payload = await verifyToken(token, secret)
  const id = Number(payload?.uid || 0)
  if (!id) return null
  return await c.env.DB.prepare('SELECT id, email, role FROM admin_users WHERE id=?').bind(id).first() as any
}

function mediaSafeKey(raw: unknown): string {
  const key = String(raw || '').trim()
  if (!key || !key.startsWith('media/') || key.includes('..')) return ''
  return key
}

async function detachDeletedMediaReferences(c: any, objectKey: string): Promise<void> {
  const publicUrl = '/media/' + objectKey.slice('media/'.length)
  const settings = await readSettingsMap(c.env, getTenantId(c))
  let settingsChanged = false
  if (String(settings.contact_qr_url || '').trim() === publicUrl) { await SettingsStore.for(c.env).delete('contact_qr_url'); settingsChanged = true }
  const { getImageStore, saveImageStore } = await import('../../utils/imageSettings')
  const store = getImageStore(settings)
  let imageChanged = false
  if (store.home?.key === objectKey || store.home?.url === publicUrl) { delete store.home; imageChanged = true }
  for (const group of ['cities', 'services'] as const) { for (const [slug, entry] of Object.entries(store[group])) { if (entry?.key === objectKey || entry?.url === publicUrl) { delete store[group][slug]; imageChanged = true } } }
  if (imageChanged) { await saveSetting(c.env, 'image_settings_json', saveImageStore(store), getTenantId(c)); settingsChanged = true }
  if (settingsChanged) await c.executionCtx?.waitUntil?.(purgeCacheAll(c.executionCtx))
}

export async function permanentlyDeleteMediaObject(c: any, objectKey: string): Promise<boolean> {
  const key = mediaSafeKey(objectKey)
  if (!key) return false
  try {
    const existing = await c.env.R2_MEDIA.head(key)
    if (!existing) {
      await c.env.DB.prepare('DELETE FROM media_assets WHERE object_key=?').bind(key).run()
      return false
    }
    await c.env.R2_MEDIA.delete(key)
    await c.env.DB.prepare('DELETE FROM media_assets WHERE object_key=?').bind(key).run()
    await detachDeletedMediaReferences(c, key)
    await c.executionCtx?.waitUntil?.(purgeCacheTags(c.executionCtx, [mediaCacheTag(key)]))
    return true
  } catch (e) {
    safeError('permanent media delete failed', e, { key })
    return false
  }
}

export async function getSeoGeneratedPageStats(env: Bindings, tenantId: number): Promise<SeoGeneratedPageStats> {
  const t = Number(tenantId) || 1
  const [keywordCleanupRow, duplicateRow, positiveLandingRows, activeCityRows, activeServiceRows, directRows, legacyRaw, aiArticleRow, publishedAiArticleRow, lowScoreArticleRow, serviceLinksRaw] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM keywords WHERE tenant_id = ? AND (COALESCE(opportunity_score,0) <= 0 OR city_id IS NULL OR service_id IS NULL)").bind(t).first(),
    env.DB.prepare("SELECT COUNT(*) AS duplicate_groups, COALESCE(SUM(n - 1),0) AS duplicate_count FROM (SELECT lower(trim(COALESCE(keyword,''))) AS normalized_keyword, COALESCE(city_id,-1) AS city_key, COALESCE(service_id,-1) AS service_key, COUNT(*) AS n FROM keywords WHERE tenant_id = ? GROUP BY normalized_keyword, city_key, service_key HAVING COUNT(*) > 1)").bind(t).first(),
    env.DB.prepare("SELECT k.landing_slug, s.slug AS service_slug FROM keywords k JOIN cities c ON c.id=k.city_id AND c.tenant_id = ? JOIN services s ON s.id=k.service_id AND s.tenant_id = ? WHERE k.tenant_id = ? AND k.landing_slug IS NOT NULL AND COALESCE(k.opportunity_score,0) >= 65 AND c.is_active=1 AND s.is_active=1 ORDER BY c.sort_order, s.sort_order, k.id LIMIT 1000").bind(t, t, t).all(),
    env.DB.prepare("SELECT slug FROM cities WHERE is_active=1 AND tenant_id = ?").bind(t).all(),
    env.DB.prepare("SELECT slug FROM services WHERE is_active=1 AND tenant_id = ?").bind(t).all(),
    env.DB.prepare("SELECT key FROM settings WHERE key LIKE 'ai_page:%' AND tenant_id = ?").bind(t).all(),
    SettingsStore.forTenant(env, t).get('ai_page_content_json', ''),
    env.DB.prepare("SELECT COUNT(*) AS n FROM articles WHERE ai_generated=1 AND tenant_id = ?").bind(t).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM articles WHERE ai_generated=1 AND status='published' AND tenant_id = ?").bind(t).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM articles WHERE ai_generated=1 AND status='published' AND tenant_id = ? AND COALESCE(ai_score,0) < 65").bind(t).first(),
    SettingsStore.forTenant(env, t).get('service_external_links', ''),
  ])
  const duplicateStats = duplicateRow as any
  const serviceLinks = getServiceExternalLinks(serviceLinksRaw ? { service_external_links: serviceLinksRaw } : {})
  const validLandings = new Set((positiveLandingRows.results as any[]).filter((row) => !serviceLinks[String(row.service_slug || '').trim()]).map((row) => String(row.landing_slug || '').trim()).filter(Boolean))
  const validCities = new Set((activeCityRows.results as any[]).map((row) => String(row.slug || '').trim()).filter(Boolean))
  const validServices = new Set((activeServiceRows.results as any[]).map((row) => String(row.slug || '').trim()).filter(Boolean))
  const direct = { cities: new Set<string>(), services: new Set<string>(), landing: new Set<string>() }
  const invalidDirectKeys: string[] = []
  for (const row of directRows.results as any[]) {
    const key = String(row.key || '')
    const match = /^ai_page:(cities|services|landing):(.+)$/.exec(key)
    if (!match || !match[2]) continue
    const group = match[1] as 'cities' | 'services' | 'landing'
    const pageKey = match[2]
    direct[group].add(pageKey)
    const valid = group === 'landing' ? validLandings.has(pageKey) : group === 'cities' ? validCities.has(pageKey) : validServices.has(pageKey)
    if (!valid) invalidDirectKeys.push(key)
  }
  const legacy = { cities: new Set<string>(), services: new Set<string>(), landing: new Set<string>() }
  if (legacyRaw) {
    try {
      const raw = JSON.parse(legacyRaw)
      for (const group of ['cities', 'services', 'landing'] as const) {
        const keys = raw?.[group] && typeof raw[group] === 'object' ? Object.keys(raw[group]) : []
        for (const pageKey of keys) legacy[group].add(String(pageKey))
      }
    } catch (e) { safeWarn('ai_page_content_json parse failed while auditing cleanup', { error: String(e) }) }
  }
  const legacyInvalid = {
    cities: Array.from(legacy.cities).filter((key) => !validCities.has(key)),
    services: Array.from(legacy.services).filter((key) => !validServices.has(key)),
    landing: Array.from(legacy.landing).filter((key) => !validLandings.has(key)),
  }
  const generatedCities = new Set([...direct.cities, ...legacy.cities]).size
  const generatedServices = new Set([...direct.services, ...legacy.services]).size
  const generatedLandings = new Set([...direct.landing, ...legacy.landing]).size
  const invalidCities = new Set([...legacyInvalid.cities, ...invalidDirectKeys.filter((key) => key.startsWith('ai_page:cities:')).map((key) => key.slice('ai_page:cities:'.length))]).size
  const invalidServices = new Set([...legacyInvalid.services, ...invalidDirectKeys.filter((key) => key.startsWith('ai_page:services:')).map((key) => key.slice('ai_page:services:'.length))]).size
  const invalidLandings = new Set([...legacyInvalid.landing, ...invalidDirectKeys.filter((key) => key.startsWith('ai_page:landing:')).map((key) => key.slice('ai_page:landing:'.length))]).size
  return {
    keywordCleanup: Number((keywordCleanupRow as any)?.n || 0),
    duplicateKeywords: Number(duplicateStats?.duplicate_count || 0),
    duplicateKeywordGroups: Number(duplicateStats?.duplicate_groups || 0),
    generatedCities, generatedServices, generatedLandings,
    sitemapLandings: validLandings.size,
    publishedAiArticles: Number((publishedAiArticleRow as any)?.n || 0),
    generatedAiArticles: Number((aiArticleRow as any)?.n || 0),
    lowScorePublishedAiArticles: Number((lowScoreArticleRow as any)?.n || 0),
    invalidCities, invalidServices, invalidLandings,
    invalidTotal: invalidCities + invalidServices + invalidLandings,
    invalidDirectKeys, legacyInvalid,
  }
}

export async function cleanupInvalidSeoGeneratedPages(env: Bindings, tenantId: number, stats: SeoGeneratedPageStats) {
  const statements = stats.invalidDirectKeys.map((key) => env.DB.prepare('DELETE FROM settings WHERE key=? AND tenant_id=?').bind(key, tenantId))
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50))
  }

  const store = SettingsStore.forTenant(env, tenantId)
  const settingsRaw = await store.get('ai_page_content_json', '')
  if (!settingsRaw) return
  try {
    const storeObj = JSON.parse(settingsRaw)
    let changed = false
    for (const group of ['cities', 'services', 'landing'] as const) {
      for (const key of stats.legacyInvalid[group]) {
        if (storeObj?.[group] && Object.prototype.hasOwnProperty.call(storeObj[group], key)) {
          delete storeObj[group][key]
          changed = true
        }
      }
    }
    if (changed) {
      await store.set('ai_page_content_json', JSON.stringify(storeObj))
    }
  } catch (e) {
    safeWarn('ai_page_content_json cleanup skipped because legacy JSON is invalid', { error: String(e) })
  }
}

export async function deleteSitemapLandingPages(env: Bindings, tenantId: number): Promise<number> {
  const store = SettingsStore.forTenant(env, tenantId)
  const serviceLinksRaw = await store.get('service_external_links', '')
  const serviceLinks = getServiceExternalLinks(serviceLinksRaw ? { service_external_links: serviceLinksRaw } : {})
  const rows = (await env.DB.prepare("SELECT k.landing_slug, s.slug AS service_slug FROM keywords k JOIN cities c ON c.id=k.city_id JOIN services s ON s.id=k.service_id WHERE k.landing_slug IS NOT NULL AND COALESCE(k.opportunity_score,0) > 0 AND c.is_active=1 AND s.is_active=1 AND k.tenant_id = ? ORDER BY c.sort_order, s.sort_order, k.id LIMIT 1000").bind(tenantId).all()).results as any[]
  const slugs = Array.from(new Set(rows.filter((row) => !serviceLinks[String(row.service_slug || '').trim()]).map((row) => String(row.landing_slug || '').trim()).filter(Boolean)))
  if (!slugs.length) return 0
  const statements: any[] = []
  for (const slug of slugs) {
    statements.push(env.DB.prepare('DELETE FROM keywords WHERE landing_slug=? AND tenant_id=?').bind(slug, tenantId))
    statements.push(env.DB.prepare('DELETE FROM settings WHERE key=? AND tenant_id=?').bind(aiContentSettingKey('landing', slug), tenantId))
  }
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50))
  const legacyRaw = await store.get('ai_page_content_json', '')
  if (legacyRaw) {
    try {
      const stored = JSON.parse(legacyRaw)
      let changed = false
      for (const slug of slugs) {
        if (stored?.landing && Object.prototype.hasOwnProperty.call(stored.landing, slug)) { delete stored.landing[slug]; changed = true }
      }
      if (changed) await store.set('ai_page_content_json', JSON.stringify(stored))
    } catch (e) { safeWarn('legacy landing cleanup skipped because JSON is invalid', { error: String(e) }) }
  }
  return slugs.length
}

export async function deletePublishedAiArticles(env: Bindings, tenantId: number): Promise<number> {
  const rows = (await env.DB.prepare("SELECT id FROM articles WHERE ai_generated=1 AND status='published' AND tenant_id=? ORDER BY id").bind(tenantId).all()).results as any[]
  const statements: any[] = []
  for (const row of rows) {
    statements.push(env.DB.prepare('DELETE FROM social_posts WHERE article_id=?').bind(row.id))
    statements.push(env.DB.prepare('DELETE FROM review_logs WHERE article_id=?').bind(row.id))
    statements.push(env.DB.prepare('DELETE FROM articles WHERE id=? AND tenant_id=?').bind(row.id, tenantId))
  }
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50))
  return rows.length
}

export async function deleteAllGeneratedSeoData(env: Bindings, tenantId: number): Promise<{ keywords: number; aiArticles: number; aiPageSettings: number }> {
  const [keywordRow, articleRow, pageRow] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM keywords WHERE tenant_id=?').bind(tenantId).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM articles WHERE ai_generated=1 AND tenant_id=?").bind(tenantId).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'ai_page:%' AND tenant_id=?").bind(tenantId).first(),
  ])
  const keywords = Number((keywordRow as any)?.n || 0)
  const aiArticles = Number((articleRow as any)?.n || 0)
  const aiPageSettings = Number((pageRow as any)?.n || 0)

  await env.DB.batch([
    env.DB.prepare("DELETE FROM social_posts WHERE article_id IN (SELECT id FROM articles WHERE ai_generated=1 AND tenant_id=?)").bind(tenantId),
    env.DB.prepare("DELETE FROM review_logs WHERE article_id IN (SELECT id FROM articles WHERE ai_generated=1 AND tenant_id=?)").bind(tenantId),
    env.DB.prepare("DELETE FROM articles WHERE ai_generated=1 AND tenant_id=?").bind(tenantId),
    env.DB.prepare("DELETE FROM keywords WHERE tenant_id=?").bind(tenantId),
    env.DB.prepare("DELETE FROM settings WHERE key LIKE 'ai_page:%' AND tenant_id=?").bind(tenantId),
    env.DB.prepare("DELETE FROM settings WHERE key='ai_page_content_json' AND tenant_id=?").bind(tenantId),
  ])

  return { keywords, aiArticles, aiPageSettings }
}

export async function deleteDuplicateKeywordRows(env: Bindings, tenantId: number): Promise<number> {
  const rows = (await env.DB.prepare("SELECT id, landing_slug FROM (SELECT id, landing_slug, ROW_NUMBER() OVER (PARTITION BY lower(trim(COALESCE(keyword,''))), COALESCE(city_id,-1), COALESCE(service_id,-1) ORDER BY COALESCE(opportunity_score,0) DESC, COALESCE(search_volume,0) DESC, id ASC) AS rn FROM keywords WHERE tenant_id=? ) WHERE rn > 1 ORDER BY id").bind(tenantId).all()).results as any[]
  if (!rows.length) return 0

  const statements = rows.map((row) => env.DB.prepare('DELETE FROM keywords WHERE id=? AND tenant_id=?').bind(row.id, tenantId))
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50))

  const slugs = Array.from(new Set(rows.map((row) => String(row.landing_slug || '').trim()).filter(Boolean)))
  const remainingSlugs = new Set<string>()
  for (let i = 0; i < slugs.length; i += 50) {
    const chunk = slugs.slice(i, i + 50)
    const placeholders = chunk.map(() => '?').join(',')
    const remaining = (await env.DB.prepare(`SELECT DISTINCT landing_slug FROM keywords WHERE tenant_id=? AND landing_slug IN (${placeholders})`).bind(tenantId, ...chunk).all()).results as any[]
    for (const row of remaining) {
      const slug = String(row.landing_slug || '').trim()
      if (slug) remainingSlugs.add(slug)
    }
  }

  const orphanSlugs = slugs.filter((slug) => !remainingSlugs.has(slug))
  const cleanupSettings = orphanSlugs.map((slug) => env.DB.prepare('DELETE FROM settings WHERE key=? AND tenant_id=?').bind(aiContentSettingKey('landing', slug), tenantId))
  for (let i = 0; i < cleanupSettings.length; i += 50) await env.DB.batch(cleanupSettings.slice(i, i + 50))

  if (orphanSlugs.length) {
    const settings = await readSettingsMap(env, tenantId)
    const store = getAiContentStore(settings)
    let changed = false
    for (const slug of orphanSlugs) {
      if (Object.prototype.hasOwnProperty.call(store.landing, slug)) {
        delete store.landing[slug]
        changed = true
      }
    }
    if (changed) await saveSetting(env, 'ai_page_content_json', saveAiContentStore(store), tenantId)
  }

  return rows.length
}

export async function optimizeSeoAuditTarget(env: Bindings, target: SeoAuditView): Promise<string> {
  if (!target.aiGenerated) throw new Error('只允许优化 AI 生成内容')
  const tenantId = target.tenantId ?? 1
  const globalSeoKeywords = await getGlobalSeoKeywords(env)

  if (target.type === 'home' || target.type === 'list') {
    const key = String(target.key || '')
    // 白名单直接取自 MANAGED_PAGE_META，新增受管页面（如 cases）时不需要在这里补一遍。
    if (!isManagedPageKey(key)) throw new Error('页面类型无效')
    const settings = await readSettingsMap(env, tenantId)
    const pages = getPageSettings(settings)
    const page = pages[key]
    if (!page) throw new Error('页面不存在')
    const ai = await generateAiPageContent(env, tenantId, {
      type: 'page',
      pageLabel: page.labelZh,
      pagePath: page.path,
      title: page.titleZh,
      summary: page.subtitleZh,
      sourceContent: page.contentZh,
    })
    if (!ai) throw new Error('AI没有返回通过质量门槛的页面内容')
    const pageKeywordCandidates = [
      page.labelZh,
      page.labelZh + '服务',
      page.labelZh + '办理',
      page.labelZh + '流程',
      ...normalizeKeywordCandidates(globalSeoKeywords, 15),
    ]
    const pageKeywords = alignSeoKeywordsToContent(
      pageKeywordCandidates,
      ai.title,
      ai.summary,
      ai.content,
      5,
    )
    pages[key] = {
      ...page,
      titleZh: ai.title,
      subtitleZh: ai.summary,
      contentZh: ai.content,
      seoKeywordsZh: pageKeywords.join(','),
      aiGenerated: true,
    }
    await saveSetting(env, 'page_settings_json', serializePageSettings(pages), tenantId)
    return ai.title
  }

  const id = Number(target.dbId || 0)
  if (!id) throw new Error('页面 ID 无效')

  if (target.type === 'article') {
    const article = await env.DB.prepare('SELECT * FROM articles WHERE id=? AND tenant_id=? LIMIT 1').bind(id, tenantId).first() as any
    if (!article) throw new Error('文章不存在')
    const ai = await generateAiPageContent(env, tenantId, {
      type: 'article',
      title: String(article.title || ''),
      summary: String(article.summary || ''),
      keywords: getArticleAiKeywords(String(article.title || ''), String(article.summary || '')),
      sourceContent: String(article.content || '').slice(0, 6000),
    })
    if (!ai) throw new Error('AI没有返回通过质量门槛的文章内容')
    const sourceUrl = String(article.source_url || '').trim()
    const sourceLink = sourceUrl
      ? '<p><strong>原文章链接：</strong><a href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="nofollow noopener">' + escapeHtml(sourceUrl) + '</a></p>'
      : ''
    const content = String(ai.content || '').trim() + sourceLink
    const seo = autoArticleSeo(
      { title: ai.title || article.title, summary: ai.summary || article.summary, content },
      env.SITE_NAME || '网站内容平台',
      globalSeoKeywords,
    )
    await env.DB.prepare(
      "UPDATE articles SET title=?, summary=?, content=?, seo_title=?, seo_description=?, seo_keywords=?, ai_generated=1, updated_at=datetime('now') WHERE id=? AND tenant_id=?"
    ).bind(
      String(ai.title || article.title).trim(),
      String(ai.summary || article.summary).trim(),
      content,
      seo.seo_title,
      seo.seo_description,
      seo.seo_keywords,
      id,
      tenantId,
    ).run()
    await env.DB.prepare(
      'INSERT INTO review_logs (article_id, action, operator, note) VALUES (?, ?, ?, ?)'
    ).bind(id, 'ai_optimize', 'AI自动', 'SEO审计一键优化').run()
    return String(ai.title || article.title || target.title)
  }

  if (target.type === 'city') {
    const city = await env.DB.prepare('SELECT * FROM cities WHERE id=? AND tenant_id=? LIMIT 1').bind(id, tenantId).first() as any
    if (!city) throw new Error('城市不存在')
    const keywords = await getCityAiKeywords(env, tenantId, id, String(city.name || ''), globalSeoKeywords)
    const ai = await generateAiPageContent(env, tenantId, { type: 'city', city: city.name, keywords })
    if (!ai) throw new Error('AI没有返回通过质量门槛的城市内容')
    const seo = autoCitySeo({ name: String(city.name || '') }, env.SITE_NAME || '网站内容平台', globalSeoKeywords)
    await env.DB.prepare('UPDATE cities SET seo_title=?, seo_description=?, seo_keywords=? WHERE id=? AND tenant_id=?')
      .bind(seo.seo_title, seo.seo_description, normalizeSeoKeywords(keywords.length ? keywords : seo.seo_keywords, 5).join(','), id, tenantId).run()
    await saveSetting(env, aiContentSettingKey('cities', String(city.slug || '')), JSON.stringify({ ...ai, updatedAt: new Date().toISOString() }))
    return String(ai.title || city.name || target.title)
  }

  if (target.type === 'service') {
    const service = await env.DB.prepare('SELECT * FROM services WHERE id=? AND tenant_id=? LIMIT 1').bind(id, tenantId).first() as any
    if (!service) throw new Error('服务不存在')
    const keywords = await getServiceAiKeywords(env, tenantId, id, String(service.name || ''), globalSeoKeywords)
    const ai = await generateAiPageContent(env, tenantId, { type: 'service', service: service.name, keywords })
    if (!ai) throw new Error('AI没有返回通过质量门槛的服务内容')
    const seo = autoServiceSeo(
      { name: String(service.name || ''), summary: String(service.summary || '') },
      env.SITE_NAME || '网站内容平台',
      globalSeoKeywords,
    )
    await env.DB.prepare('UPDATE services SET seo_title=?, seo_description=?, seo_keywords=? WHERE id=?')
      .bind(seo.seo_title, seo.seo_description, normalizeSeoKeywords(keywords.length ? keywords : seo.seo_keywords, 5).join(','), id).run()
    await saveSetting(env, aiContentSettingKey('services', String(service.slug || '')), JSON.stringify({ ...ai, updatedAt: new Date().toISOString() }))
    return String(ai.title || service.name || target.title)
  }

  if (target.type === 'landing') {
    const kw = await env.DB.prepare(
      `SELECT k.*, ci.name AS city_name, ci.slug AS city_slug, s.name AS service_name, s.slug AS service_slug
       FROM keywords k
       LEFT JOIN cities ci ON ci.id=k.city_id
       LEFT JOIN services s ON s.id=k.service_id
       WHERE k.id=?`
    ).bind(id).first() as any
    if (!kw) throw new Error('落地页关键词不存在')
    const ai = await generateAiPageContent(env, tenantId, {
      type: 'landing',
      city: kw.city_name,
      service: kw.service_name,
      keyword: kw.keyword,
      weight: Number(kw.opportunity_score || 0),
    })
    if (!ai) throw new Error('AI没有返回通过质量门槛的落地页内容')
    const key = kw.landing_slug || (String(kw.city_slug || '') + '-' + String(kw.service_slug || ''))
    await saveSetting(env, aiContentSettingKey('landing', key), JSON.stringify({
      ...ai,
      weight: Number(kw.opportunity_score || 0),
      updatedAt: new Date().toISOString(),
    }))
    return String(ai.title || (String(kw.city_name || '') + String(kw.service_name || '')))
  }

  throw new Error('不支持的 SEO 页面类型')
}

export async function deleteSeoAuditTarget(env: Bindings, target: SeoAuditView): Promise<void> {
  if (!target.aiGenerated) throw new Error('只允许删除 AI 生成内容')
  const tenantId = target.tenantId ?? 1

  if (target.type === 'home' || target.type === 'list') {
    const key = String(target.key || '')
    if (!isManagedPageKey(key)) throw new Error('页面类型无效')
    const settings = await readSettingsMap(env, tenantId)
    const store = getPageSettings(settings)
    const page = store[key]
    if (!page) throw new Error('页面不存在')
    store[key] = {
      ...page,
      titleZh: '',
      titleEn: '',
      subtitleZh: '',
      subtitleEn: '',
      contentZh: '',
      contentEn: '',
      seoKeywordsZh: '',
      seoKeywordsEn: '',
      aiGenerated: false,
    }
    await saveSetting(env, 'page_settings_json', serializePageSettings(store), tenantId)
    if (key === 'home') await saveSetting(env, 'site_seo_ai_generated', '0', tenantId)
    return
  }

  const id = Number(target.dbId || 0)
  if (!id) throw new Error('页面 ID 无效')

  if (target.type === 'article') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM social_posts WHERE article_id=?').bind(id),
      env.DB.prepare('DELETE FROM review_logs WHERE article_id=?').bind(id),
      env.DB.prepare('DELETE FROM articles WHERE id=? AND ai_generated=1 AND tenant_id=?').bind(id, tenantId),
    ])
    return
  }

  const settings = await readSettingsMap(env)
  const store = getAiContentStore(settings)

  if (target.type === 'city') {
    const row = await env.DB.prepare('SELECT slug FROM cities WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
    const slug = String(row?.slug || '')
    if (!slug) throw new Error('城市页面不存在')
    delete store.cities[slug]
    await env.DB.prepare('DELETE FROM settings WHERE key=?').bind(aiContentSettingKey('cities', slug)).run()
  } else if (target.type === 'service') {
    const row = await env.DB.prepare('SELECT slug FROM services WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
    const slug = String(row?.slug || '')
    if (!slug) throw new Error('服务页面不存在')
    delete store.services[slug]
    await env.DB.prepare('DELETE FROM settings WHERE key=?').bind(aiContentSettingKey('services', slug)).run()
  } else if (target.type === 'landing') {
    const row = await env.DB.prepare('SELECT landing_slug FROM keywords WHERE id=?').bind(id).first() as any
    const landingSlug = String(row?.landing_slug || '')
    delete store.landing[landingSlug]
    if (landingSlug) {
      await env.DB.prepare('DELETE FROM settings WHERE key=?').bind(aiContentSettingKey('landing', landingSlug)).run()
    }
    await env.DB.prepare('DELETE FROM keywords WHERE id=?').bind(id).run()
  } else {
    throw new Error('不支持的 SEO 页面类型')
  }

  await saveSetting(env, 'ai_page_content_json', saveAiContentStore(store))
}

export async function syncPageSeoKeywords(env: Bindings, tenantId: number): Promise<{ cities: number; services: number; articles: number }> {
  const globalSeoKeywords = await getGlobalSeoKeywords(env, tenantId)
  const profileSettings = await readSettingsMap(env, tenantId)
  const siteProfile = getSiteProfile(profileSettings, env.SITE_NAME || '')
  const [cityRows, serviceRows, articleRows, matrixRows] = await Promise.all([
    env.DB.prepare('SELECT id, name FROM cities WHERE is_active=1 AND tenant_id=? ORDER BY sort_order, id').bind(tenantId).all(),
    env.DB.prepare('SELECT id, name FROM services WHERE is_active=1 AND tenant_id=? ORDER BY sort_order, id').bind(tenantId).all(),
    env.DB.prepare("SELECT id, title, summary, content FROM articles WHERE status='published' AND tenant_id=? ORDER BY id").bind(tenantId).all(),
    env.DB.prepare('SELECT city_id, service_id, keyword FROM keywords WHERE city_id IS NOT NULL AND service_id IS NOT NULL AND tenant_id=? AND COALESCE(opportunity_score,0)>0 ORDER BY opportunity_score DESC, search_volume DESC, id ASC').bind(tenantId).all(),
  ])

  const cityKeywords = new Map<number, string[]>()
  const serviceKeywords = new Map<number, string[]>()
  const cityNameById = new Map<number, string>((cityRows.results as any[]).map((row) => [Number(row.id || 0), String(row.name || '').trim()]))
  for (const row of matrixRows.results as any[]) {
    const keyword = String(row.keyword || '').trim()
    if (!keyword) continue
    const cityId = Number(row.city_id || 0)
    const serviceId = Number(row.service_id || 0)
    if (cityId) {
      const list = cityKeywords.get(cityId) || []
      if (list.length < 5) cityKeywords.set(cityId, normalizeSeoKeywords([...list, keyword], 5))
    }
    if (serviceId) {
      const cityName = cityNameById.get(cityId) || ''
      const serviceTopic = cityName && keyword.startsWith(cityName) ? keyword.slice(cityName.length).trim() : keyword
      const list = serviceKeywords.get(serviceId) || []
      if (list.length < 5) serviceKeywords.set(serviceId, normalizeSeoKeywords([...list, serviceTopic], 5))
    }
  }

  const statements: any[] = []
  for (const row of cityRows.results as any[]) {
    const id = Number(row.id || 0)
    const name = String(row.name || '').trim()
    const fallback = [name + siteProfile.topic, name + '服务', name + '流程', name + '注意事项']
    const keywords = normalizeSeoKeywords([...(cityKeywords.get(id) || []), ...fallback], 5)
    statements.push(env.DB.prepare('UPDATE cities SET seo_keywords=? WHERE id=?').bind(keywords.join(','), id))
  }

  for (const row of serviceRows.results as any[]) {
    const id = Number(row.id || 0)
    const name = String(row.name || '').trim()
    const fallback = [name, name + '服务', name + '流程', name + '注意事项']
    const keywords = normalizeSeoKeywords([...(serviceKeywords.get(id) || []), ...fallback], 5)
    statements.push(env.DB.prepare('UPDATE services SET seo_keywords=? WHERE id=?').bind(keywords.join(','), id))
  }

  for (const row of articleRows.results as any[]) {
    const keywords = buildArticleSeoKeywords(String(row.title || ''), String(row.summary || ''), String(row.content || ''), globalSeoKeywords, siteProfile).slice(0, 5)
    statements.push(env.DB.prepare('UPDATE articles SET seo_keywords=? WHERE id=?').bind(keywords.join(','), row.id))
  }

  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50))
  }

  return {
    cities: cityRows.results.length,
    services: serviceRows.results.length,
    articles: articleRows.results.length,
  }
}

export async function generateKeywordMatrix(env: Bindings): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO keywords
      (keyword, city_id, service_id, status, difficulty, opportunity_score, landing_slug, city_weight, service_weight)
     SELECT
      c.name || s.name, c.id, s.id, 'pending',
      CASE
        WHEN c.tier='一线' AND COALESCE(s.demand_weight,50)>=70 THEN '高'
        WHEN c.tier='一线' OR COALESCE(s.demand_weight,50)>=70 THEN '中'
        ELSE '低'
      END,
      CAST(ROUND(
        (
          (CASE c.tier WHEN '一线' THEN 100 WHEN '新一线' THEN 75 WHEN '二线' THEN 55 WHEN '三线' THEN 35 ELSE 50 END) * 0.5
          + COALESCE(s.demand_weight,50) * 0.3
          + (100 - CASE
              WHEN c.tier='一线' AND COALESCE(s.demand_weight,50)>=70 THEN 55
              WHEN c.tier='一线' OR COALESCE(s.demand_weight,50)>=70 THEN 30
              ELSE 10
            END) * 0.2
        ) * 0.8
      ) AS INTEGER),
      c.slug || '-' || s.slug,
      CASE c.tier WHEN '一线' THEN 100 WHEN '新一线' THEN 75 WHEN '二线' THEN 55 WHEN '三线' THEN 35 ELSE 50 END,
      COALESCE(s.demand_weight,50)
     FROM cities c CROSS JOIN services s
     WHERE c.is_active=1 AND s.is_active=1
     ON CONFLICT(city_id, service_id) DO UPDATE SET
       keyword=excluded.keyword,
       difficulty=excluded.difficulty,
       landing_slug=excluded.landing_slug,
       city_weight=excluded.city_weight,
       service_weight=excluded.service_weight`
  ).run()
  const changed = Number((result as any)?.meta?.changes || 0)
  await rescoreAllKeywords(env)
  return changed
}

export async function rescoreAllKeywords(env: Bindings): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE keywords
     SET opportunity_score = CAST(ROUND(
       (
         (CASE (SELECT tier FROM cities WHERE id=keywords.city_id)
            WHEN '一线' THEN 100 WHEN '新一线' THEN 75 WHEN '二线' THEN 55 WHEN '三线' THEN 35 ELSE 50 END) * 0.5
         + COALESCE((SELECT demand_weight FROM services WHERE id=keywords.service_id),50) * 0.3
         + (100 - CASE keywords.difficulty WHEN '高' THEN 55 WHEN '低' THEN 10 ELSE 30 END) * 0.2
       ) * 0.8
       + CASE
           WHEN COALESCE(keywords.search_volume,0) >= 10000 THEN 20
           WHEN COALESCE(keywords.search_volume,0) >= 1000 THEN 15
           WHEN COALESCE(keywords.search_volume,0) >= 100 THEN 10
           WHEN COALESCE(keywords.search_volume,0) >= 10 THEN 5
           ELSE 0
         END
     ) AS INTEGER)`
  ).run()
  return Number((result as any)?.meta?.changes || 0)
}

export { getTenantId } from '../../db/scoped'
export { getContactMethods } from '../../utils/contactSettings'
export { escapeHtml } from '../../templates/layout'
