import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { readSettingsMap, saveSetting, getGlobalSeoKeywords, buildPublicSeoAudit,
  getSeoGeneratedPageStats, cleanupInvalidSeoGeneratedPages, deleteSitemapLandingPages,
  deletePublishedAiArticles, deleteAllGeneratedSeoData, deleteDuplicateKeywordRows,
  rescoreAllKeywords, syncPageSeoKeywords, generateKeywordMatrix, getTenantId,
  optimizeSeoAuditTarget, deleteSeoAuditTarget,
} from './shared'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { safeError, safeWarn } from '../../utils/safeLogger'
import { purgeCacheAll } from '../../middleware/cache'
import { renderSeoPage, renderGeoPage, renderSocialSettingsPage, renderSocialDistributionPage, renderStructuredDataPage } from '../../templates/admin'
import { PLATFORM_LIST } from '../../utils/socialPlatforms'
import { getAiSettings } from '../../utils/aiSettings'
import { answerMentionsSite, summarizeCitations, type CitationRecord } from '../../utils/geoCitations'
import { checkGeoContent } from '../../utils/geoCheck'
import { getSystemSecret } from '../../utils/systemSecrets'
import { SettingsStore } from '../../utils/settingsStore'
import { getIndexNowKey } from '../../utils/seo'
import { submitAllEngines, getAllPublishedUrls } from '../../utils/seo'
import { hasProtectedSecret } from '../../utils/protectedSecrets'
import { resolveSiteUrl } from '../../utils/siteUrl'
import { errorMessage } from '../../utils/errors'

export const adminSeoRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const GEO_PROBE_DAILY_LIMIT = 10

adminSeoRoutes.post('/seo/auto-fill', async (c) => {
  const siteName = c.env.SITE_NAME || '网站内容平台'
  try {
    const [cityResult, serviceResult, articleResult] = await Promise.all([
      c.env.DB.prepare(`UPDATE cities SET seo_title = CASE WHEN TRIM(COALESCE(seo_title,'')) = '' OR length(seo_title) > 120 THEN substr(name || '服务_解决方案_流程指南 - ' || ?, 1, 120) ELSE seo_title END, seo_description = CASE WHEN TRIM(COALESCE(seo_description,'')) = '' OR length(seo_description) > 180 THEN substr(name || '围绕当前站点行业主题提供服务范围、办理流程、准备资料和风险提醒。', 1, 180) ELSE seo_description END WHERE is_active=1`).bind(siteName).run(),
      c.env.DB.prepare(`UPDATE services SET seo_title = CASE WHEN TRIM(COALESCE(seo_title,'')) = '' OR length(seo_title) > 120 THEN substr(name || ' - ' || ?, 1, 120) ELSE seo_title END, seo_description = CASE WHEN TRIM(COALESCE(seo_description,'')) = '' OR length(seo_description) > 180 THEN substr(name || '专业服务，提供合规、清晰、可执行的办理支持。' || COALESCE(NULLIF(summary,''),'围绕企业实际业务场景提供流程、材料说明和风险提醒。'), 1, 180) ELSE seo_description END WHERE is_active=1`).bind(siteName).run(),
      c.env.DB.prepare(`UPDATE articles SET seo_title = CASE WHEN TRIM(COALESCE(seo_title,'')) = '' OR length(seo_title) > 120 THEN substr(title || ' - ' || ?,1,120) ELSE seo_title END, seo_description = CASE WHEN TRIM(COALESCE(seo_description,'')) = '' OR length(COALESCE(seo_description,'')) > 180 THEN substr(COALESCE(NULLIF(summary,''), title || '相关行业政策与实务解读。'),1,180) ELSE seo_description END WHERE status='published'`).bind(siteName).run(),
    ])
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    const c1 = Number((cityResult as any)?.meta?.changes || 0), c2 = Number((serviceResult as any)?.meta?.changes || 0), c3 = Number((articleResult as any)?.meta?.changes || 0)
    return c.redirect('/admin/keywords?message=' + encodeURIComponent('已补齐内容页 SEO 元数据：城市 ' + c1 + '、服务 ' + c2 + '、文章 ' + c3 + ' 条；并统一页面主题词为 3-5 个。不会修改固定候选词库、Sitemap、Robots、GEO 或正文。'))
  } catch (e) { safeError('seo auto-fill failed', e); return c.redirect('/admin/keywords?error=' + encodeURIComponent('全部页面 SEO 规范失败：' + errorMessage(e, '未知错误'))) }
})

adminSeoRoutes.get('/geo', async (c) => {
  const tenantId = getTenantId(c)
  const map = await SettingsStore.forTenant(c.env, tenantId).getMany([
    'geo_ai_crawlers_enabled', 'geo_llms_enabled',
    'site_author_name', 'site_author_title', 'site_author_credentials', 'site_author_expertise', 'site_author_url',
    'site_logo_url', 'site_og_image', 'site_social_links',
  ])
  const [audit, articleRows, citationRows] = await Promise.all([
    buildPublicSeoAudit(c.env, tenantId),
    c.env.DB.prepare("SELECT id, title, slug, content, ai_generated FROM articles WHERE status='published' AND tenant_id = ? ORDER BY published_at DESC, id DESC LIMIT 200").bind(tenantId).all(),
    c.env.DB.prepare("SELECT platform, model, query, mentioned, cited_url, checked_on FROM geo_citations WHERE tenant_id = ? ORDER BY checked_on DESC, id DESC LIMIT 500").bind(tenantId).all(),
  ])
  const geoArticles = (articleRows.results as any[]).map((row) => ({ id: Number(row.id), title: String(row.title || ''), slug: String(row.slug || ''), aiGenerated: !!row.ai_generated, check: checkGeoContent({ title: String(row.title || ''), content: String(row.content || '') }) }))
  const citations: CitationRecord[] = (citationRows.results as any[]).map((row) => ({ platform: String(row.platform || ''), model: String(row.model || ''), query: String(row.query || ''), mentioned: Number(row.mentioned) === 1, citedUrl: String(row.cited_url || ''), checkedOn: String(row.checked_on || '') }))

  // AI 爬虫访问统计。未应用 0003 迁移的库会报 no such table，
  // 这里降级成「无数据」而不是让整个 GEO 页面 500。
  const crawlerWindowDays = 30
  let crawlerTotals: Array<{ bot: string; hits: number; lastSeen: string }> = []
  let crawlerToday: Array<{ bot: string; hits: number; lastPath: string; lastSeen: string }> = []
  try {
    const [totals, today] = await Promise.all([
      c.env.DB.prepare(
        `SELECT bot, SUM(hits) AS hits, MAX(last_seen_at) AS last_seen
         FROM ai_crawler_hits
         WHERE tenant_id = ? AND hit_date >= date('now', ?)
         GROUP BY bot ORDER BY hits DESC LIMIT 30`
      ).bind(getTenantId(c), `-${crawlerWindowDays - 1} days`).all(),
      c.env.DB.prepare(
        `SELECT bot, hits, last_path, last_seen_at
         FROM ai_crawler_hits
         WHERE tenant_id = ? AND hit_date = date('now')
         ORDER BY hits DESC LIMIT 30`
      ).bind(getTenantId(c)).all(),
    ])
    crawlerTotals = (totals.results as any[]).map((row) => ({ bot: String(row.bot || ''), hits: Number(row.hits || 0), lastSeen: String(row.last_seen || '') }))
    crawlerToday = (today.results as any[]).map((row) => ({ bot: String(row.bot || ''), hits: Number(row.hits || 0), lastPath: String(row.last_path || ''), lastSeen: String(row.last_seen_at || '') }))
  } catch (e) {
    safeWarn('ai crawler stats read failed; table may be missing', { error: String(e) })
  }

  return c.html(renderGeoPage({
    siteUrl: await resolveSiteUrl(c),
    aiCrawlersEnabled: map['geo_ai_crawlers_enabled'] !== '0',
    llmsEnabled: map['geo_llms_enabled'] !== '0',
    saved: c.req.query('saved') === '1',
    error: c.req.query('error') || '',
    seoSummary: audit.summary,
    geoArticles,
    citationSummary: summarizeCitations(citations),
    citationTotal: citations.length,
    probeLimit: GEO_PROBE_DAILY_LIMIT,
    crawlerStats: { totals: crawlerTotals, today: crawlerToday, windowDays: crawlerWindowDays },
    entity: {
      authorName: String(map['site_author_name'] || ''),
      authorTitle: String(map['site_author_title'] || ''),
      authorCredentials: String(map['site_author_credentials'] || ''),
      authorExpertise: String(map['site_author_expertise'] || ''),
      authorUrl: String(map['site_author_url'] || ''),
      logoUrl: String(map['site_logo_url'] || ''),
      ogImage: String(map['site_og_image'] || ''),
      socialLinks: String(map['site_social_links'] || ''),
    },
    siteName: await resolveAdminSiteName(c.env, getTenantId(c)),
    cspNonce: (c as any).get('cspNonce') || '',
    csrfToken: (c as any).get('csrfToken') || '',
  }))
})

adminSeoRoutes.post('/geo', async (c) => {
  const b = await c.req.parseBody()
  await saveSetting(c.env, 'geo_ai_crawlers_enabled', b.geo_ai_crawlers_enabled === 'on' ? '1' : '0', getTenantId(c))
  await saveSetting(c.env, 'geo_llms_enabled', b.geo_llms_enabled === 'on' ? '1' : '0', getTenantId(c))
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/geo?saved=1')
})

// 署名与站点实体设置（E-E-A-T）。
// 这些值会被 layoutContext 注入到全站每个页面，改完必须清缓存，否则前台还是旧实体。
adminSeoRoutes.post('/geo/entity', async (c) => {
  const b = await c.req.parseBody()
  const tenantId = getTenantId(c)
  const field = (key: string, max: number) => String(b[key] || '').trim().slice(0, max)

  const logoUrl = field('site_logo_url', 300)
  const ogImage = field('site_og_image', 300)
  const authorUrl = field('site_author_url', 300)

  // 图片与作者页地址写入的是 Organization.logo / og:image / Person.url，
  // 带进无效地址会让结构化数据整体校验失败，所以这里直接拒绝而不是静默存下。
  const urlish = (value: string) => !value || /^https?:\/\//i.test(value) || value.startsWith('/')
  const urlFields: Array<[string, string, string]> = [
    ['site_logo_url', logoUrl, '站点 logo'],
    ['site_og_image', ogImage, '默认分享图'],
    ['site_author_url', authorUrl, '作者页地址'],
  ]
  for (const [, value, label] of urlFields) {
    if (!urlish(value)) {
      return c.redirect('/admin/geo?error=' + encodeURIComponent(`${label}必须是 http(s) 绝对地址，或以 / 开头的站内路径。`))
    }
  }

  const socialRaw = String(b.site_social_links || '').split(/[\n,，;；]+/).map((v) => v.trim()).filter(Boolean)
  const socialLinks = socialRaw.filter((v) => /^https?:\/\//i.test(v)).slice(0, 10)

  const values: Array<[string, string]> = [
    ['site_author_name', field('site_author_name', 80)],
    ['site_author_title', field('site_author_title', 80)],
    ['site_author_credentials', field('site_author_credentials', 200)],
    ['site_author_expertise', field('site_author_expertise', 200)],
    ['site_author_url', authorUrl],
    ['site_logo_url', logoUrl],
    ['site_og_image', ogImage],
    ['site_social_links', socialLinks.join('\n')],
  ]
  for (const [key, value] of values) await saveSetting(c.env, key, value, tenantId)
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))

  const dropped = socialRaw.length - socialLinks.length
  if (dropped > 0) {
    return c.redirect('/admin/geo?saved=1&error=' + encodeURIComponent(`已保存，但官方主页里有 ${dropped} 条不是 http(s) 地址，已忽略。`))
  }
  return c.redirect('/admin/geo?saved=1')
})

/** 每种 @type 的必需字段，用于本机结构化数据校验。 */
const STRUCTURED_DATA_RULES: Record<string, { required: string[]; note: string }> = {
  Organization: { required: ['name', 'url', 'logo'], note: 'Google 的 Organization 富结果要求 name / url / logo' },
  WebSite: { required: ['name', 'url'], note: '站点实体，SearchAction 可选' },
  WebPage: { required: ['name', 'url'], note: '页面实体' },
  BreadcrumbList: { required: ['itemListElement'], note: '面包屑，会直接显示在搜索结果里' },
  Article: { required: ['headline', 'datePublished', 'author', 'publisher'], note: '发布时间与作者是 AI 引擎判断新鲜度和可信度的核心' },
  FAQPage: { required: ['mainEntity'], note: '问答对；页面必须同时有可见的问答内容' },
  Service: { required: ['name', 'provider'], note: '服务实体' },
  Person: { required: ['name'], note: '作者实体（E-E-A-T）' },
}

export type StructuredDataInspection = {
  path: string
  status: number
  types: string[]
  errors: string[]
  warnings: string[]
  /** FAQPage 里的问题在可见正文里找不到对应文本时记录，属于标记滥用风险。 */
  invisibleFaq: string[]
}

/**
 * 抓取本站页面并检查其中的 JSON-LD。
 * 只接受同源 URL 由调用方保证，避免这个端点变成任意 URL 抓取器（SSRF）。
 */
async function inspectStructuredData(siteUrl: string, path: string): Promise<StructuredDataInspection> {
  const result: StructuredDataInspection = { path, status: 0, types: [], errors: [], warnings: [], invisibleFaq: [] }
  let html = ''
  try {
    const response = await fetch(siteUrl + path, {
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'white-label-cms-structured-data-check' },
    })
    result.status = response.status
    html = (await response.text()).slice(0, 500000)
  } catch (e) {
    result.errors.push('无法抓取该页面：' + String((e as Error).message).slice(0, 160) + '。线上出现通常是域名还没解析；也可以改用 Google Rich Results Test 手工验证。')
    return result
  }

  const blocks = Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)).map((m) => m[1] || '')
  const nodes: any[] = []
  for (const raw of blocks) {
    try {
      const parsed = JSON.parse(raw)
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) if (node && typeof node === 'object') nodes.push(node)
    } catch (e) {
      // 一块 JSON-LD 解析失败会让整块失效，这是最常见的"结构化数据没生效"原因。
      result.errors.push('JSON-LD 解析失败：' + String((e as Error).message).slice(0, 140))
    }
  }

  const seen = new Set<string>()
  for (const node of nodes) {
    const type = String(node['@type'] || '')
    if (!type) { result.warnings.push('存在缺少 @type 的 JSON-LD 节点'); continue }
    if (!seen.has(type)) { seen.add(type); result.types.push(type) }
    const rule = STRUCTURED_DATA_RULES[type]
    if (!rule) { result.warnings.push(`${type}：模板未登记校验规则，仅列出类型`) ; continue }
    const missing = rule.required.filter((key) => node[key] === undefined || node[key] === null || node[key] === '')
    if (missing.length) result.errors.push(`${type} 缺少必需字段：${missing.join(', ')}（${rule.note}）`)
  }

  if (!result.types.includes('Organization')) result.errors.push('缺少 Organization：AI 引擎与搜索引擎需要它来确认站点主体身份')

  // FAQPage 的合规检查：可见正文里必须能找到每个问题，否则属于标记滥用。
  const visible = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  for (const node of nodes) {
    if (String(node['@type'] || '') !== 'FAQPage') continue
    const mainEntity = Array.isArray(node.mainEntity) ? node.mainEntity : []
    for (const question of mainEntity) {
      const name = String(question?.name || '').trim()
      if (name && !visible.includes(name)) result.invisibleFaq.push(name.slice(0, 80))
    }
  }

  if (result.status !== 200) result.warnings.push(`页面返回 HTTP ${result.status}，未按公开页处理`)
  return result
}

adminSeoRoutes.get('/geo/structured-data', async (c) => {
  const siteUrl = await resolveSiteUrl(c)
  const tenantId = getTenantId(c)
  const paths = ['/', '/article', '/service', '/city']
  try {
    const latest = await c.env.DB.prepare(
      "SELECT slug FROM articles WHERE status='published' AND tenant_id = ? ORDER BY published_at DESC, id DESC LIMIT 1"
    ).bind(tenantId).first() as any
    if (latest?.slug) paths.splice(1, 0, '/article/' + latest.slug)
  } catch (e) {
    safeError('structured data check: latest article lookup failed', e)
  }
  const results: StructuredDataInspection[] = []
  for (const path of paths) results.push(await inspectStructuredData(siteUrl, path))
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""
  return c.html(renderStructuredDataPage({ siteUrl, results, siteName, cspNonce, csrfToken }))
})

adminSeoRoutes.post('/geo/citations', async (c) => {
  const b = await c.req.parseBody()
  const platform = String(b.platform || '').trim().slice(0, 60), query = String(b.query || '').trim().slice(0, 300)
  if (!platform || !query) return c.redirect('/admin/geo?error=' + encodeURIComponent('请填写平台与查询问题'))
  await c.env.DB.prepare("INSERT INTO geo_citations (platform, model, query, mentioned, cited_url, source, tenant_id) VALUES (?, ?, ?, ?, ?, 'manual', ?)").bind(platform, String(b.model || '').trim().slice(0, 120), query, b.mentioned === 'on' ? 1 : 0, String(b.cited_url || '').trim().slice(0, 500), getTenantId(c)).run()
  return c.redirect('/admin/geo?saved=1')
})

adminSeoRoutes.post('/geo/citations/probe', async (c) => {
  const b = await c.req.parseBody()
  const query = String(b.query || '').trim().slice(0, 300)
  const autoIndustry = b.auto_industry === '1' || b.auto_industry === 'on'
  const today = new Date().toISOString().slice(0, 10)
  const quotaKey = 'geo_probe_quota:' + today
  const used = Number((await c.env.CACHE_KV?.get(quotaKey)) || 0)

  const tenantId = getTenantId(c)
  const siteSettings = await SettingsStore.forTenant(c.env, tenantId).getMap('all')
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const siteIndustry = String(siteSettings.site_industry || '')
  const siteTopic = String(siteSettings.site_topic || '')
  const primaryKeywords = String(siteSettings.primary_keywords || '')
  const industryKeywords = String(siteSettings.industry_keywords || '')
  const siteUrl = String(siteSettings.site_url || '')

  // 自动行业关键词检测：基于站点行业、主题、核心关键词生成检测问题
  const autoKeywords = [siteIndustry, siteTopic, primaryKeywords, industryKeywords]
    .filter(Boolean)
    .join('、')
    .split(/[，,、\s]+/)
    .filter(Boolean)

  const questions = autoIndustry && autoKeywords.length
    ? autoKeywords.map((kw) => `${kw}是什么`).slice(0, 5)
    : query ? [query] : []

  if (!questions.length) return c.redirect('/admin/geo?error=' + encodeURIComponent('请填写要检测的问题，或先在「系统设置」中配置行业、主题与核心关键词。'))
  if (used + questions.length > GEO_PROBE_DAILY_LIMIT) return c.redirect('/admin/geo?error=' + encodeURIComponent(`今日抽样检测剩余配额不足（剩余 ${GEO_PROBE_DAILY_LIMIT - used} 次，本次需要 ${questions.length} 次），明天再试或手动录入。`))

  const results: Array<{ query: string; answer: string; model: string; mentioned: boolean; citedUrl: string }> = []

  for (const q of questions) {
    if (used >= GEO_PROBE_DAILY_LIMIT) break
    let answer = '', model = ''
    try {
      const settings = await getAiSettings(c.env, getTenantId(c))
      model = settings.provider === 'openai_compatible' ? settings.externalModel : settings.model
      const result = await runConfiguredAi(c.env, { messages: [{ role: 'user', content: q }] }, settings)
      answer = await getAiResponseText(result)
    } catch (e) {
      safeError('geo probe failed', e)
    }
    const check = answerMentionsSite(answer, siteName, siteUrl)
    await c.env.DB.prepare("INSERT INTO geo_citations (platform, model, query, mentioned, cited_url, source, tenant_id) VALUES (?, ?, ?, ?, ?, 'probe', ?)").bind('内部通道', model, q, check.mentioned ? 1 : 0, check.citedUrl, getTenantId(c)).run()
    results.push({ query: q, answer, model, mentioned: check.mentioned, citedUrl: check.citedUrl })
    await c.env.CACHE_KV?.put(quotaKey, String((used || 0) + results.length), { expirationTtl: 2 * 86400 })
  }

  return c.redirect('/admin/geo?saved=1&geo_probe_results=' + encodeURIComponent(JSON.stringify(results)))
})

adminSeoRoutes.get('/social/settings', async (c) => {
  const tenantId = getTenantId(c)
  const settings = await readSettingsMap(c.env, getTenantId(c)); ;(settings as any).__social_saved = c.req.query('saved') || ''; ;(settings as any).__social_error = c.req.query('error') || ''
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  return c.html(renderSocialSettingsPage(settings, PLATFORM_LIST, siteName, (c as any).get('cspNonce') || '', (c as any).get('csrfToken') || ''))
})

adminSeoRoutes.post('/social/settings', async (c) => {
  const body = await c.req.parseBody()
  for (const platform of PLATFORM_LIST) { const key = 'social_entry_' + platform.key, value = String(body[key] || '').trim(); if (value && !/^https?:\/\//i.test(value)) return c.redirect('/admin/social/settings?error=' + encodeURIComponent(platform.label + '入口必须是 http:// 或 https:// 地址')); await saveSetting(c.env, key, value, getTenantId(c)) }
  await purgeCacheAll(c.executionCtx)
  return c.redirect('/admin/social/settings?saved=1')
})

adminSeoRoutes.get('/social', async (c) => {
  const tenantId = getTenantId(c)
  const settings = await SettingsStore.forTenant(c.env, tenantId).getMap('all')
  const rows = (await c.env.DB.prepare("SELECT a.id, a.title, a.published_at, MAX(CASE WHEN s.platform='douyin' THEN s.status ELSE 'not_synced' END) AS douyin_status, MAX(CASE WHEN s.platform='kuaishou' THEN s.status ELSE 'not_synced' END) AS kuaishou_status, MAX(CASE WHEN s.platform='xiaohongshu' THEN s.status ELSE 'not_synced' END) AS xiaohongshu_status, MAX(CASE WHEN s.platform='bilibili' THEN s.status ELSE 'not_synced' END) AS bilibili_status FROM articles a LEFT JOIN social_posts s ON s.article_id=a.id WHERE a.status='published' AND a.tenant_id = ? GROUP BY a.id ORDER BY a.published_at DESC, a.id DESC LIMIT 100").bind(tenantId).all()).results as any[]
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  return c.html(renderSocialDistributionPage(rows, PLATFORM_LIST, siteName, (c as any).get('cspNonce') || '', (c as any).get('csrfToken') || ''))
})

adminSeoRoutes.get('/seo', async (c) => {
  const engine = String(c.req.query('engine') || '').trim(), result = String(c.req.query('result') || '').trim(), q = String(c.req.query('q') || '').trim()
  const tenantId = getTenantId(c)
  // submit_logs 带 tenant_id 列，推送日志必须按租户隔离，否则后台会看到别的站点提交记录。
  const where: string[] = ['tenant_id = ?'], params: Array<string | number> = [tenantId]
  const channelSettings = await SettingsStore.forTenant(c.env, tenantId).getMany(['indexnow_key', 'baidu_token', 'so_token', 'sogou_token'])
  const channels = {
    indexnow: !!(await getIndexNowKey(c.env)),
    bing: !!(await getIndexNowKey(c.env)),
    baidu: !!(await getSystemSecret(c.env, 'BAIDU_TOKEN')) || !!channelSettings.baidu_token,
    '360': !!(await getSystemSecret(c.env, 'SO_TOKEN')) || !!channelSettings.so_token,
    sogou: !!(await getSystemSecret(c.env, 'SOGOU_TOKEN')) || !!channelSettings.sogou_token,
    google: await hasProtectedSecret(c.env, 'GOOGLE_SERVICE_ACCOUNT_JSON') || !!String(c.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim(),
  }
  if (engine) { where.push('engine = ?'); params.push(engine) }
  if (q) { const like = '%' + escapeLike(q) + '%'; where.push(`(url LIKE ? ESCAPE char(92) OR response LIKE ? ESCAPE char(92) OR CAST(status_code AS TEXT) LIKE ? ESCAPE char(92))`); params.push(like, like, like) }
  if (result === 'success') where.push('status_code >= 200 AND status_code < 300')
  else if (result === 'failure') where.push('(status_code IS NULL OR status_code < 200 OR status_code >= 300)')
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const countRow = await c.env.DB.prepare(`SELECT SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS success_count, SUM(CASE WHEN status_code IS NULL OR status_code < 200 OR status_code >= 300 THEN 1 ELSE 0 END) AS failure_count FROM submit_logs ${clause}`).bind(...params).first() as any
  const logs = (await c.env.DB.prepare(`SELECT * FROM submit_logs ${clause} ORDER BY created_at DESC LIMIT 100`).bind(...params).all()).results
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""
  return c.html(renderSeoPage({ siteUrl: await resolveSiteUrl(c), recentLogs: logs as any, successCount: Number(countRow?.success_count || 0), failureCount: Number(countRow?.failure_count || 0), engine, result, q, channels, notifyStarted: c.req.query('notify') === '1', notifyCount: Number(c.req.query('notify_count') || 0), siteName, cspNonce: cspNonce, csrfToken: csrfToken }))
})

adminSeoRoutes.post('/seo/logs/:id/retry', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  const log = await c.env.DB.prepare('SELECT id, url, status_code, response FROM submit_logs WHERE id=? AND tenant_id=? LIMIT 1').bind(id, getTenantId(c)).first() as any
  if (!log) return c.notFound()
  const status = Number(log.status_code || 0), skipped = status === 0 && /(基础模板|不调用|不重复调用|请在|手动)/.test(String(log.response || ''))
  if (skipped) return c.redirect('/admin/seo?result=failure&q=' + encodeURIComponent(String(log.url || '')) + '&retry=skipped')
  const url = String(log.url || '').trim()
  if (!/^https?:\/\//i.test(url)) return c.redirect('/admin/seo?result=failure&retry=invalid')
  const siteUrl = await resolveSiteUrl(c)
  c.executionCtx.waitUntil(submitAllEngines(c.env, [url], siteUrl).catch((e) => safeError('SEO log retry failed', undefined, { id, url, error: String(e) })))
  return c.redirect('/admin/seo?notify=1&notify_count=1&retry=1&q=' + encodeURIComponent(url))
})

adminSeoRoutes.post('/seo/logs/:id/delete', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  await c.env.DB.prepare('DELETE FROM submit_logs WHERE id=? AND tenant_id=?').bind(id, getTenantId(c)).run()
  return c.redirect('/admin/seo')
})

adminSeoRoutes.post('/seo/submit', async (c) => {
  const siteUrl = await resolveSiteUrl(c)
  const urls = await getAllPublishedUrls(c.env, getTenantId(c), siteUrl)
  const unique = Array.from(new Set(urls))
  c.executionCtx.waitUntil(submitAllEngines(c.env, unique, siteUrl).catch((e) => safeError('manual SEO submission failed', e)))
  return c.redirect('/admin/seo?notify=1&notify_count=' + unique.length)
})

adminSeoRoutes.post('/seo-audit/optimize-one', async (c) => {
  const body = await c.req.parseBody()
  const type = String(body.type || '')
  const key = String(body.key || '')
  const id = Number(body.id || 0)
  if (!['home', 'list', 'article', 'city', 'service', 'landing'].includes(type)) {
    return c.json({ ok: false, error: '无效的 SEO 页面类型' }, 400)
  }
  const { pages } = await buildPublicSeoAudit(c.env, getTenantId(c))
  const target = pages.find((p) =>
    p.type === type &&
    ((type === 'home' || type === 'list') ? String(p.key) === key : Number(p.dbId || 0) === id)
  )
  if (!target) return c.json({ ok: false, error: '页面不存在或已被修改' }, 404)
  if (!target.aiGenerated) return c.json({ ok: false, error: '只允许 AI 生成内容进入 AI 优化流程' }, 400)
  if (target.audit.status !== 'weak' && target.audit.status !== 'blocked') {
    return c.json({ ok: false, error: '当前页面无需 AI 低分优化' }, 400)
  }

  try {
    const title = await optimizeSeoAuditTarget(c.env, target)
    await syncPageSeoKeywords(c.env, getTenantId(c))
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    return c.json({ ok: true, title, scoreBefore: target.audit.score })
  } catch (e) {
    safeError('SEO audit optimize one failed', e)
    return c.json({ ok: false, error: errorMessage(e, 'SEO 页面优化失败') }, 503)
  }
})

adminSeoRoutes.post('/seo-audit/delete', async (c) => {
  const body = await c.req.parseBody()
  const type = String(body.type || '')
  const id = Number(body.id || 0)
  if (!['home', 'list', 'article', 'city', 'service', 'landing'].includes(type) || ((type !== 'home' && type !== 'list') && !id)) {
    return c.redirect('/admin/keywords?error=' + encodeURIComponent('无效的 SEO 页面清理请求。'))
  }

  const { pages } = await buildPublicSeoAudit(c.env, getTenantId(c))
  const target = pages.find((p) => p.type === type && ((type === 'home' || type === 'list') ? String(p.key) === String(body.key || '') : Number(p.dbId || 0) === id))
  if (!target) return c.redirect('/admin/keywords?error=' + encodeURIComponent('页面不存在，或当前已经不满足清理条件。'))
  if (!target.aiGenerated) return c.redirect('/admin/keywords?error=' + encodeURIComponent('只允许删除 AI 生成内容，人工内容不会被此入口删除。'))

  try {
    await deleteSeoAuditTarget(c.env, target)
    await syncPageSeoKeywords(c.env, getTenantId(c))
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    c.header('Cache-Control', 'no-store')
    return c.redirect('/admin/keywords?message=' + encodeURIComponent('已删除：' + target.title + '（评分 ' + target.audit.score + '）。'))
  } catch (e) {
    safeError('SEO audit single delete failed', e)
    return c.redirect('/admin/keywords?error=' + encodeURIComponent(errorMessage(e, 'SEO 页面删除失败')))
  }
})

// 一键优化：每次 HTTP 只跑 1 次 AI，浏览器自动连续调用，避免单个 Worker 因多次 AI 生成而触发 1101。
adminSeoRoutes.post('/seo-audit/optimize-low-batch', async (c) => {
  const body = await c.req.parseBody()
  const excluded = new Set(
    String(body.exclude || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 100),
  )
  const { pages } = await buildPublicSeoAudit(c.env, getTenantId(c))
  const targets = pages
    .filter((p) => p.audit.indexable && p.audit.score >= 50 && p.audit.score < 68 && p.aiGenerated && ['home', 'list', 'article', 'city', 'service', 'landing'].includes(p.type) && (p.type === 'home' || p.type === 'list' || p.dbId))
    .filter((p) => !excluded.has(String(p.type) + ':' + String(p.dbId || p.key)))
    .sort((a, b) => a.audit.score - b.audit.score)

  if (!targets.length) return c.json({ ok: true, complete: true, processed: 0, remaining: 0 })
  try {
    const target = targets[0]!
    const title = await optimizeSeoAuditTarget(c.env, target)
    const key = String(target.type) + ':' + String(target.dbId)
    return c.json({ ok: true, complete: false, processed: 1, title, key, remainingHint: Math.max(0, targets.length - 1) })
  } catch (e) {
    safeError('SEO audit optimize batch failed', e)
    return c.json({ ok: false, error: errorMessage(e, 'SEO 页面优化失败') }, 503)
  }
})

// 一键删除：每次只删除少量低价值 AI 内容；包含不可索引 AI 页面。人工内容不进入队列。
adminSeoRoutes.post('/seo-audit/cleanup-low-batch', async (c) => {
  const { pages } = await buildPublicSeoAudit(c.env, getTenantId(c))
  const targets = pages
    .filter((p) => (!p.audit.indexable || p.audit.score < 50) && p.aiGenerated && ['home', 'list', 'article', 'city', 'service', 'landing'].includes(p.type) && (p.type === 'home' || p.type === 'list' || p.dbId))
    .sort((a, b) => a.audit.score - b.audit.score)
    .slice(0, 10)

  if (!targets.length) return c.json({ ok: true, complete: true, processed: 0, remaining: 0 })

  let processed = 0
  const errors: string[] = []
  for (const target of targets) {
    try {
      await deleteSeoAuditTarget(c.env, target)
      processed++
    } catch (e) {
      errors.push(errorMessage(e, '删除失败'))
    }
  }
  return c.json({
    ok: errors.length === 0,
    complete: targets.length < 10,
    processed,
    remainingHint: Math.max(0, targets.length === 10 ? 1 : 0),
    errors: errors.slice(0, 3),
  }, errors.length ? 503 : 200)
})

// 兼容旧入口：仍可由其他页面直接提交，默认只清理评分 <50 或不可索引的 AI 内容。
adminSeoRoutes.post('/seo-audit/cleanup-low', async (c) => {
  const { pages } = await buildPublicSeoAudit(c.env, getTenantId(c))
  const thresholdRaw = Number((await c.req.parseBody()).threshold || 50)
  const threshold = Math.min(50, Math.max(0, Number.isFinite(thresholdRaw) ? Math.trunc(thresholdRaw) : 50))
  const targets = pages
    .filter((p) => (!p.audit.indexable || p.audit.score < threshold) && p.aiGenerated && ['article', 'city', 'service', 'landing'].includes(p.type) && p.dbId)
    .sort((a, b) => a.audit.score - b.audit.score)
    .slice(0, 10)
  if (!targets.length) {
    return c.redirect('/admin/keywords?error=' + encodeURIComponent('当前没有可删除的低质量/不可索引 AI 内容。'))
  }
  let removed = 0
  for (const target of targets) {
    try { await deleteSeoAuditTarget(c.env, target); removed++ } catch (e) { safeError('SEO cleanup target failed', e) }
  }
  return c.redirect('/admin/keywords?message=' + encodeURIComponent('已清理 ' + removed + ' 个低质量/不可索引 AI 内容；如仍有项目，可继续一键清理。'))
})

async function runConfiguredAi(env: Bindings, input: Record<string, unknown>, settings: any): Promise<any | null> { const { runConfiguredAi } = await import('../../utils/aiSettings'); return runConfiguredAi(env, input, settings) }
async function getAiResponseText(res: any): Promise<string> { const { getAiResponseText } = await import('../../utils/aiJson'); return getAiResponseText(res) }
function escapeLike(value: string): string { return value.replace(/[%_\\]/g, (ch) => '\\' + ch) }
