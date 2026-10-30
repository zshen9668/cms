import { Hono } from 'hono'
import { safeError } from '../utils/safeLogger'
import { rateLimit } from '../middleware/security'
import { verifyTurnstile, type TurnstileResult } from '../plugins/turnstile/index'
import { purgeCacheAll } from '../middleware/cache'
import type { Bindings, Variables } from '../types'
import { renderLayout, absoluteUrl } from '../templates/layout'
import {
  renderHome, renderCityPage, renderCityServicePage, renderArticlePage, renderArticleList, renderNewList, renderSubprojectPage,
  renderServiceList, renderServiceDetail, renderCityList, renderAboutPage, renderContactPage, renderSearchResults,
  toDateTimeAttr,
} from '../templates/public'
import { renderCaseList, renderCasePage } from '../templates/publicCases'
import {
  getPublicCases, getHomeCases, getCaseBySlug, isCasePublic, caseDisplayTitle, casePublicPath,
  buildCaseJsonLd, countPublicCases, CASE_HOME_LIMIT, type CaseRecord,
} from '../utils/cases'
import { resolveSiteUrl } from '../utils/siteUrl'
import { shouldSampleView, trackPageView } from '../utils/stats'
import { t, type Locale } from '../utils/i18n'
import { normalizeLocale } from '../utils/localeResolve'
import { getLanguageConfig } from '../modules/languageManager/storage'
import { getPageSettings } from '../utils/pageSettings'
import { articleCategoryMenu } from '../utils/navCategories'
import { faqPageJsonLd, parseArticleFaq } from '../utils/articleSchema'
import { buildLayoutChrome } from '../utils/layoutContext'
import { fillTemplate } from '../utils/template'
import { isUtmSourceAllowed } from '../utils/utm'
import { MIN_INDEXABLE_OPPORTUNITY_SCORE } from '../utils/keywordScore'
import { getServiceExternalLinks } from '../utils/serviceSettings'
import { getAiContentEntryDb } from '../utils/aiContentStore'
import { getImageStore } from '../utils/imageSettings'
import { getContactMethods } from '../utils/contactSettings'
import { getSiteProfile } from '../utils/siteProfile'
import { getPageContact } from '../utils/pageContacts'
import { subprojectPagePath, type SubprojectSection } from '../utils/subprojects'
import { escapeLike, safeInternalPath } from '../utils/geo'
import { SettingsStore } from '../utils/settingsStore'
import { getTenantId, scoped } from '../db/scoped'

export const publicRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// 前台 HTML 内容来自 D1/设置，不能让 Cloudflare 按无 Cache-Control 的默认规则缓存长达数小时。
// 采用短缓存 + 后台刷新，兼顾页面设置即时性与 Workers CPU/数据库负载。
publicRoutes.use('*', async (c, next) => {
  await next()
  const res = c.res
  if (!res) return
  const contentType = res.headers.get('content-type') || ''
  if (c.req.method === 'GET' && res.status === 200 && contentType.includes('text/html')) {
    res.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
    res.headers.set('Cloudflare-CDN-Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
  }
})

async function getSettings(env: Bindings, tenantId: number): Promise<Record<string, string>> {
  if (!env.DB) return {}
  try {
    const settings = await SettingsStore.forTenant(env, tenantId).getMap('all')
    // 画像名称优先作为站点名称，确保自定义画像名称全站生效（标题/描述/导航/页脚）
    if (settings.site_profile_name && !settings.site_name) {
      settings.site_name = settings.site_profile_name
    }
    return settings
  } catch (e) {
    safeError('D1 settings read failed; using defaults', e)
    return {}
  }
}

/**
 * 构造面包屑。第一层固定是首页，后续按调用方传入的 [名称, 路径] 追加。
 * 输出会同时生成可见面包屑导航与 BreadcrumbList 结构化数据，
 * 两者必须成对出现——只有结构化数据没有可见内容属于标记滥用。
 */
function crumbs(locale: Locale, ...trail: Array<[string, string]>) {
  return [
    { name: t(locale, 'nav.home'), path: '/' },
    ...trail.map(([name, path]) => ({ name, path })),
  ]
}
function withHomeContactDescription(description: string, methods: ReturnType<typeof getContactMethods>, locale: Locale): string {
  const base = String(description || '').trim().slice(0, 180)
  const parts: string[] = []
  if (methods.phones.length) parts.push((locale === 'zh-CN' ? '电话' : 'Phone') + ': ' + methods.phones.join(', '))
  if (methods.wechats.length) parts.push((locale === 'zh-CN' ? '微信' : 'WeChat') + ': ' + methods.wechats.join(', '))
  if (methods.qqs.length) parts.push('QQ: ' + methods.qqs.join(', '))
  const contact = parts.join(' · ')
  return contact ? [base, contact].filter(Boolean).join(' · ').slice(0, 320) : base
}

/** 站点默认 title/description 模板渲染。未配置模板时原样返回现有 title/description（回退）。 */
function renderSeoMeta(settings: Record<string, string>, siteName: string, page: {
  title: string
  description: string
  keyword?: string
  serviceName?: string
  cityName?: string
  summary?: string
}): { title: string; description: string } {
  const titleTpl = String(settings.site_default_title_template || '').trim()
  const descTpl = String(settings.site_default_desc_template || '').trim()
  const baseValues: Record<string, string> = {
    site_name: siteName,
    page_title: page.title,
    keyword: page.keyword || '',
    service_name: page.serviceName || '',
    city_name: page.cityName || '',
    summary: page.summary || '',
  }
  return {
    title: titleTpl ? fillTemplate(titleTpl, baseValues) || page.title : page.title,
    description: descTpl ? fillTemplate(descTpl, baseValues) || page.description : page.description,
  }
}

async function getActiveSubprojects(env: Bindings, section: SubprojectSection, tenantId: number): Promise<any[]> {
  try {
    const { sql, params } = scoped('SELECT id, section, name, slug, label_zh, label_en, title_zh, title_en, subtitle_zh, subtitle_en, content_zh, content_en, seo_title_zh, seo_title_en, seo_description_zh, seo_description_en, seo_keywords_zh, seo_keywords_en, layout, is_active, sort_order FROM subprojects WHERE section=? AND is_active=1 ORDER BY sort_order, id LIMIT 50', tenantId)
    const rows = (await env.DB.prepare(sql).bind(...params, section).all()).results as any[]
    return rows.map((row) => ({ ...row, frontend_path: subprojectPagePath(section, String(row.slug || '')) }))
  } catch (e) {
    // 专题表/专题数据异常时，不影响服务、城市和资讯主列表。
    safeError('D1 subprojects read failed; continuing without subprojects', e)
    return []
  }
}

async function getSubprojectWithItems(env: Bindings, section: SubprojectSection, slug: string, tenantId: number): Promise<{ project: any; items: any[] } | null> {
  const { sql: projectSql, params: projectParams } = scoped('SELECT * FROM subprojects WHERE section=? AND slug=? AND is_active=1 LIMIT 1', tenantId)
  const project = await env.DB.prepare(projectSql).bind(...projectParams, section, slug).first() as any
  if (!project) return null
  // 主表列名与 active/order 全部显式带 s. 前缀：subproject_items 与主表存在同名列，
  // 未限定的列名在 JOIN 里会触发 ambiguous column name。
  const meta: any = section === 'service' ? { type: 'service', table: 'services', fields: 's.id,s.name,s.slug,s.summary,s.sort_order', active: 's.is_active=1', order: 'si.sort_order,s.sort_order,s.id' }
    : section === 'city' ? { type: 'city', table: 'cities', fields: 's.id,s.name,s.slug,s.province,s.tier,s.sort_order', active: 's.is_active=1', order: 'si.sort_order,s.sort_order,s.id' }
    : { type: 'article', table: 'articles', fields: 's.id,s.title AS name,s.slug,s.summary,s.category,s.published_at,s.created_at', active: "s.status='published'", order: 'si.sort_order,s.published_at DESC,s.id DESC' }
  // 这条查询 JOIN 了 subproject_items 与主表，两张表都有 tenant_id，不能交给 scoped() 自动注入：
  // 它只会生成未限定的 `tenant_id = ?`（ambiguous column name），且主表 s 拿不到任何租户过滤，
  // 会让租户 A 的栏目页展示租户 B 的 service/city/article。这里手写显式参数化 SQL，
  // s 与 si 各自带租户条件，列名全部限定。meta.* 均为上方字面量，不含运行时值。
  const itemsSql = 'SELECT ' + meta.fields + ' FROM ' + meta.table + ' s'
    + ' JOIN subproject_items si ON si.item_id = s.id AND si.item_type = ?'
    + ' WHERE si.subproject_id = ? AND si.tenant_id = ? AND s.tenant_id = ? AND ' + meta.active
    + ' ORDER BY ' + meta.order + ' LIMIT 200'
  const items = (await env.DB.prepare(itemsSql).bind(meta.type, Number(project.id), tenantId, tenantId).all()).results as any[]
  return { project, items }
}

// ---- 语言切换：写入持久 cookie 后跳回原页面 ----
// 目标地址同时带上 `?lang=`：持久 cookie 保证访客后续浏览保持该语言，
// URL 参数保证这个地址可分享、可被 hreflang / 搜索引擎当成独立语言版本。
publicRoutes.get('/lang/:code', async (c) => {
  const code = normalizeLocale(c.req.param('code'))
  const back = safeInternalPath(c.req.query('back') || '/')
  if (!code) return c.redirect(back)
  const { enabled, defaultLocale } = await getLanguageConfig(c.env, getTenantId(c))
  // 已停用的语言不写入 cookie（否则会留下一个永远生效不了的偏好）。
  if (!enabled.includes(code)) return c.redirect(back)
  // 关键修复：无论切到哪种语言（含默认语言），都显式重写持久 cookie。
  // 旧实现里 code===defaultLocale 的分支漏写 cookie，历史 lang=en 会一直生效，
  // 导致「切到英文后切不回中文」。
  c.header('Set-Cookie', `lang=${code}; Path=/; Max-Age=31536000; SameSite=Lax`)
  // 语言变更后前台 HTML 会整体变化，清掉 CDN 侧的旧缓存，让切换立刻可见。
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  const [path, ...rest] = back.split('?')
  const params = new URLSearchParams(rest.join('?'))
  if (code === defaultLocale) params.delete('lang')
  else params.set('lang', code)
  const query = params.toString()
  return c.redirect((path || '/') + (query ? '?' + query : ''))
})

publicRoutes.get('/', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  c.executionCtx.waitUntil(trackPageView(env))
  const settingsPromise = getSettings(env, tenantId)
  let settings: Record<string, string> = {}
  let cities: any[] = [], services: any[] = [], articles: any[] = []
  if (env.DB) {
    const qCities = scoped('SELECT id, name, slug, province FROM cities WHERE is_active = 1 ORDER BY sort_order LIMIT 200', tenantId)
    const qServices = scoped('SELECT id, name, slug, icon, summary FROM services WHERE is_active = 1 ORDER BY sort_order LIMIT 50', tenantId)
    const qArticles = scoped("SELECT id, title, slug, category, summary, published_at FROM articles WHERE status='published' ORDER BY published_at DESC LIMIT 6", tenantId)
    const reads = await Promise.all([
      env.DB.prepare(qCities.sql).bind(...qCities.params).all().catch((e) => { safeError('D1 cities read failed', e); return { results: [] } as any }),
      env.DB.prepare(qServices.sql).bind(...qServices.params).all().catch((e) => { safeError('D1 services read failed', e); return { results: [] } as any }),
      env.DB.prepare(qArticles.sql).bind(...qArticles.params).all().catch((e) => { safeError('D1 articles read failed', e); return { results: [] } as any }),
      settingsPromise.catch(() => ({})),
    ])
    cities = reads[0].results as any[]
    services = reads[1].results as any[]
    articles = reads[2].results as any[]
    settings = reads[3] as Record<string, string>
  } else {
    settings = await settingsPromise
  }
  const pageSettings = getPageSettings(settings)
  const homePage = pageSettings.home
  const globalContacts = getContactMethods(settings)
  const homeContact = getPageContact(settings, 'home', globalContacts)
  const homeSeoContacts = { ...globalContacts, wechats: homeContact.wechats, qqs: homeContact.qqs }
  const imageStore = getImageStore(settings)
  if (homePage.mode === 'hidden') return c.notFound()
  if (homePage.mode === 'external' && homePage.externalUrl) return c.redirect(homePage.externalUrl, 302)
  const contactMessage = c.req.query('sent') === '1' ? t(locale, 'contact.success') : ''
  // 首页「成功案例」模块。案例表异常时首页其余模块照常渲染，不影响站点可用性。
  let homeCases: CaseRecord[] = []
  let caseTotal = 0
  if (env.DB) {
    try {
      const [rows, total] = await Promise.all([getHomeCases(env, tenantId, CASE_HOME_LIMIT), countPublicCases(env, tenantId)])
      homeCases = rows
      caseTotal = total
    } catch (e) {
      safeError('D1 cases read failed', e)
    }
  }
  const cspNonce = (c as any).get("cspNonce") || ""
  const body = renderHome({ cities: cities as any, services: services as any, articles: articles as any, siteName: (settings.site_name || env.SITE_NAME || '网站内容平台'), homeCases, caseTotal, settings, contactMessage, pageSettings, locale, images: imageStore, pageContact: homeContact })
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const homeTitle = settings.site_title || siteName
  const homeDescription = withHomeContactDescription(settings.site_description || '', homeSeoContacts, locale)
  const homeMeta = renderSeoMeta(settings, siteName, {
    title: homeTitle,
    description: homeDescription,
    keyword: pageSettings.home.seoKeywordsZh || pageSettings.home.seoKeywordsEn || settings.site_keywords,
  })
  return c.html(renderLayout({
    title: homeMeta.title,
    description: homeMeta.description,
    keywords: (locale === 'zh-CN' ? homePage.seoKeywordsZh : homePage.seoKeywordsEn) || settings.site_keywords,
    siteUrl, siteName: (settings.site_name || env.SITE_NAME || '网站内容平台'), canonical: siteUrl + '/', locale, currentPath: '/',
    cspNonce,
    ...buildLayoutChrome(settings, locale, homeSeoContacts),
  }, body))
})

// ---- 服务列表 / 服务详情 ----
publicRoutes.get('/service', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  c.executionCtx.waitUntil(trackPageView(env))
  const { sql, params } = scoped('SELECT id, name, slug, icon, summary FROM services WHERE is_active = 1 ORDER BY sort_order LIMIT 50', tenantId)
  const services = (await env.DB.prepare(sql).bind(...params).all()).results
  const settings = await getSettings(env, tenantId)
  const page = getPageSettings(settings).services
  const imageStore = getImageStore(settings)
  const globalContacts = getContactMethods(settings)
  const pageContact = getPageContact(settings, 'services', globalContacts)
  if (page.mode === 'hidden') return c.notFound()
  if (page.mode === 'external' && page.externalUrl) return c.redirect(page.externalUrl, 302)
  const externalLinks = getServiceExternalLinks(settings)
  const subprojects = await getActiveSubprojects(env, 'service', tenantId)
  const siteProfile = getSiteProfile(settings, env.SITE_NAME || '')
  const cspNonce = (c as any).get("cspNonce") || ""
  const body = renderServiceList(services as any, locale, externalLinks, page, subprojects, imageStore)
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const title = (locale === 'zh-CN' ? page.titleZh : page.titleEn) || (locale === 'zh-CN' ? page.labelZh : page.labelEn)
  const description = (locale === 'zh-CN' ? page.subtitleZh : page.subtitleEn) || ('围绕' + siteProfile.topic + '提供服务范围、适用场景与办理信息。')
  const svcMeta = renderSeoMeta(settings, siteName, {
    title,
    description,
    keyword: page.labelZh + ',' + page.labelEn,
  })
  return c.html(renderLayout({
    title: svcMeta.title,
    description: svcMeta.description,
    keywords: (locale === 'zh-CN' ? page.seoKeywordsZh : page.seoKeywordsEn) || page.labelZh + ',' + page.labelEn,
    siteUrl, siteName, canonical: `${siteUrl}/service`, locale, currentPath: '/service',
    cspNonce,
    breadcrumbs: crumbs(locale, [title, '/service']),
    ...buildLayoutChrome(settings, locale),
  }, body))
})


publicRoutes.get('/service/topic/:slug', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  const slug = c.req.param('slug')
  const data = await getSubprojectWithItems(env, 'service', slug, tenantId)
  if (!data) return c.notFound()
  const settings = await getSettings(env, tenantId)
  const pageTitle = locale === 'zh-CN' ? (data.project.seo_title_zh || data.project.title_zh || data.project.label_zh) : (data.project.seo_title_en || data.project.title_en || data.project.label_en || data.project.label_zh)
  const description = locale === 'zh-CN' ? (data.project.seo_description_zh || data.project.subtitle_zh || data.project.content_zh || '') : (data.project.seo_description_en || data.project.subtitle_en || data.project.content_en || '')
  const keywords = locale === 'zh-CN' ? data.project.seo_keywords_zh : data.project.seo_keywords_en
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const topicMeta = renderSeoMeta(settings, siteName, {
    title: pageTitle,
    description,
    keyword: keywords || '',
    serviceName: pageTitle,
  })
  const body = renderSubprojectPage({ section: 'service', subproject: data.project, items: data.items, locale })
  const serviceSchemas = (data.items || []).map((item: any) => ({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: item.name,
    description: item.summary || '',
    provider: { '@type': 'Organization', name: settings.site_name || env.SITE_NAME || '网站内容平台', url: siteUrl },
    areaServed: [],
    url: siteUrl + '/service/' + item.slug,
    image: item.image ? [absoluteUrl(siteUrl, item.image)] : undefined,
  }))
  return c.html(renderLayout({
    title: topicMeta.title,
    description: topicMeta.description,
    keywords, siteUrl, siteName,
    canonical: siteUrl + '/service/topic/' + slug, locale, currentPath: '/service/topic/' + slug,
    cspNonce,
    extraJsonLd: serviceSchemas,
    ...buildLayoutChrome(settings, locale, getContactMethods(settings)),
  }, body))
})

publicRoutes.get('/service/:slug', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  c.executionCtx.waitUntil(trackPageView(env))
  const slug = c.req.param('slug')
  const { sql: serviceSql, params: serviceParams } = scoped('SELECT * FROM services WHERE slug = ?', tenantId)
  const service = await env.DB.prepare(serviceSql).bind(...serviceParams, slug).first()
  if (!service) return c.notFound()
  const serviceRow = service as any
  if (Number(serviceRow.is_active || 0) !== 1) return c.notFound()
  const settings = await getSettings(env, tenantId)
  const imageStore = getImageStore(settings)
  const externalUrl = getServiceExternalLinks(settings)[serviceRow.slug] || getServiceExternalLinks(settings)[String(serviceRow.id)] || ''
  if (externalUrl) return c.redirect(externalUrl, 302)
  const { sql: citiesSql, params: citiesParams } = scoped(`SELECT id, name, slug, province, seo_title, seo_description, seo_keywords, tier
     FROM cities
     WHERE is_active = 1
       AND EXISTS (
         SELECT 1 FROM keywords k
         WHERE k.service_id = ? AND k.city_id = cities.id AND COALESCE(k.opportunity_score,0) >= ? AND k.tenant_id = ?
       )
     ORDER BY sort_order LIMIT 200`, tenantId)
  const cities = (await env.DB.prepare(citiesSql).bind(...citiesParams, serviceRow.id, MIN_INDEXABLE_OPPORTUNITY_SCORE, tenantId).all()).results
  const globalContacts = getContactMethods(settings)
  const pageContact = getPageContact(settings, 'service:' + serviceRow.slug, globalContacts)
  const siteProfile = getSiteProfile(settings, env.SITE_NAME || '')
  const { sql: articlesSql, params: articlesParams } = scoped("SELECT id, title, slug, summary, category, published_at FROM articles WHERE status='published' AND service_id = ? ORDER BY published_at DESC LIMIT 6", tenantId)
  const relatedArticles = (await env.DB.prepare(articlesSql).bind(...articlesParams, serviceRow.id).all()).results
  const body = renderServiceDetail({ service: serviceRow, cities: cities as any, locale, aiContent: await getAiContentEntryDb(env, tenantId, settings, 'services', serviceRow.slug), image: imageStore.services[serviceRow.slug], pageContact, relatedArticles: relatedArticles as any, siteProfile })
  const serviceSchema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: serviceRow.name,
    description: serviceRow.seo_description || serviceRow.summary || '',
    serviceType: serviceRow.name,
    provider: { '@type': 'Organization', name: (settings.site_name || env.SITE_NAME || '网站内容平台'), url: siteUrl },
    areaServed: cities.map((city: any) => ({ '@type': 'City', name: city.name })).slice(0, 100),
  }
  const serviceMetaTitle = serviceRow.seo_title || `${serviceRow.name} - ${(settings.site_name || env.SITE_NAME || '网站内容平台')}`
  const serviceMetaDesc = serviceRow.seo_description || serviceRow.summary || ''
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const serviceMeta = renderSeoMeta(settings, siteName, {
    title: serviceMetaTitle,
    description: serviceMetaDesc,
    keyword: serviceRow.seo_keywords || serviceRow.name,
    serviceName: serviceRow.name,
    summary: serviceRow.summary || '',
  })
  return c.html(renderLayout({
    title: serviceMeta.title,
    description: serviceMeta.description,
    keywords: serviceRow.seo_keywords || serviceRow.name,
    extraJsonLd: [serviceSchema],
    siteUrl, siteName, canonical: `${siteUrl}/service/${slug}`, locale, currentPath: `/service/${slug}`,
    cspNonce,
    image: imageStore.services[serviceRow.slug]?.url,
    imageAlt: imageStore.services[serviceRow.slug]?.alt || serviceRow.name,
    breadcrumbs: crumbs(locale, [t(locale, 'service.list_title'), '/service'], [String(serviceRow.name || '').slice(0, 60), `/service/${slug}`]),
    ...buildLayoutChrome(settings, locale),
  }, body))
})

// ---- 城市列表 ----
publicRoutes.get('/city', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  c.executionCtx.waitUntil(trackPageView(env))
  const { sql, params } = scoped('SELECT id, name, slug, province, is_active, sort_order, seo_title, seo_description, seo_keywords, tier FROM cities WHERE is_active = 1 ORDER BY sort_order LIMIT 200', tenantId)
  const cities = (await env.DB.prepare(sql).bind(...params).all()).results
  const settings = await getSettings(env, tenantId)
  const page = getPageSettings(settings).cities
  const imageStore = getImageStore(settings)
  const globalContacts = getContactMethods(settings)
  const pageContact = getPageContact(settings, 'cities', globalContacts)
  if (page.mode === 'hidden') return c.notFound()
  if (page.mode === 'external' && page.externalUrl) return c.redirect(page.externalUrl, 302)
  const subprojects = await getActiveSubprojects(env, 'city', tenantId)
  const siteProfile = getSiteProfile(settings, env.SITE_NAME || '')
  const body = renderCityList(cities as any, locale, page, subprojects, imageStore)
  const title = (locale === 'zh-CN' ? page.titleZh : page.titleEn) || (locale === 'zh-CN' ? page.labelZh : page.labelEn)
  const description = (locale === 'zh-CN' ? page.subtitleZh : page.subtitleEn) || `覆盖${cities.length}个服务地区，提供本地化${siteProfile.topic}信息与服务。`
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const cityListMeta = renderSeoMeta(settings, siteName, {
    title,
    description,
    keyword: page.labelZh + ',' + page.labelEn,
    cityName: page.labelZh || page.labelEn,
  })
  return c.html(renderLayout({
    title: cityListMeta.title,
    description: cityListMeta.description,
    keywords: (locale === 'zh-CN' ? page.seoKeywordsZh : page.seoKeywordsEn) || (page.labelZh + ',' + page.labelEn),
    siteUrl, siteName, canonical: `${siteUrl}/city`, locale, currentPath: '/city',
    cspNonce,
    breadcrumbs: crumbs(locale, [title, '/city']),
    ...buildLayoutChrome(settings, locale),
  }, body))
})


publicRoutes.get('/city/topic/:slug', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  const slug = c.req.param('slug')
  const data = await getSubprojectWithItems(env, 'city', slug, tenantId)
  if (!data) return c.notFound()
  const settings = await getSettings(env, tenantId)
  const pageTitle = locale === 'zh-CN' ? (data.project.seo_title_zh || data.project.title_zh || data.project.label_zh) : (data.project.seo_title_en || data.project.title_en || data.project.label_en || data.project.label_zh)
  const description = locale === 'zh-CN' ? (data.project.seo_description_zh || data.project.subtitle_zh || '') : (data.project.seo_description_en || data.project.subtitle_en || '')
  const keywords = locale === 'zh-CN' ? data.project.seo_keywords_zh : data.project.seo_keywords_en
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const topicMeta = renderSeoMeta(settings, siteName, {
    title: pageTitle,
    description,
    keyword: keywords || '',
    cityName: pageTitle,
  })
  const body = renderSubprojectPage({ section: 'city', subproject: data.project, items: data.items, locale })
  return c.html(renderLayout({
    title: topicMeta.title,
    description: topicMeta.description,
    keywords, siteUrl, siteName,
    canonical: siteUrl + '/city/topic/' + slug, locale, currentPath: '/city/topic/' + slug,
    cspNonce,
    ...buildLayoutChrome(settings, locale, getContactMethods(settings)),
  }, body))
})

publicRoutes.get('/city/:slug', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  c.executionCtx.waitUntil(trackPageView(env))
  const slug = c.req.param('slug')
  const { sql: citySql, params: cityParams } = scoped('SELECT * FROM cities WHERE slug = ?', tenantId)
  const city = await env.DB.prepare(citySql).bind(...cityParams, slug).first()
  if (!city) return c.notFound()
  const cityRow = city as any
  if (Number(cityRow.is_active || 0) !== 1) return c.notFound()
  const settings = await getSettings(env, tenantId)
  const externalLinks = getServiceExternalLinks(settings)
  const { sql: serviceSql, params: serviceParams } = scoped(`SELECT id, name, slug, icon, summary, seo_title, seo_description, seo_keywords, demand_weight
     FROM services
     WHERE is_active = 1
       AND EXISTS (
         SELECT 1 FROM keywords k
         WHERE k.city_id = ? AND k.service_id = services.id AND COALESCE(k.opportunity_score,0) >= ? AND k.tenant_id = ?
       )
     ORDER BY sort_order LIMIT 50`, tenantId)
  const serviceRows = (await env.DB.prepare(serviceSql).bind(...serviceParams, cityRow.id, MIN_INDEXABLE_OPPORTUNITY_SCORE, tenantId).all()).results as any[]
  const services = serviceRows.filter((row) => !externalLinks[String(row.slug || '')])
  const { sql: articlesSql, params: articlesParams } = scoped("SELECT id, title, slug, summary, category, published_at FROM articles WHERE status='published' AND city_id = ? ORDER BY published_at DESC LIMIT 6", tenantId)
  const articles = (await env.DB.prepare(articlesSql).bind(...articlesParams, cityRow.id).all()).results
  const { sql: searchCitiesSql, params: searchCitiesParams } = scoped('SELECT id, name, slug, province FROM cities WHERE is_active = 1 ORDER BY sort_order LIMIT 200', tenantId)
  const searchCities = (await env.DB.prepare(searchCitiesSql).bind(...searchCitiesParams).all()).results
  const globalContacts = getContactMethods(settings)
  const pageContact = getPageContact(settings, 'city:' + cityRow.slug, globalContacts)
  const imageStore = getImageStore(settings)
  const siteProfile = getSiteProfile(settings, env.SITE_NAME || '')
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const title = cityRow.seo_title || `${cityRow.name}${siteProfile.topic} - ${siteName}`
  const description = cityRow.seo_description || `${cityRow.name}提供${siteProfile.topic}相关本地服务信息，包含适用场景、服务范围、流程和注意事项。`
  const cityMeta = renderSeoMeta(settings, siteName, {
    title,
    description,
    keyword: cityRow.name,
    serviceName: siteProfile.topic,
    cityName: cityRow.name,
  })
  const keywords = cityRow.seo_keywords || `${cityRow.name}${siteProfile.topic},${cityRow.name}服务`
  const body = renderCityPage({ city: city as any, services: services as any, articles: articles as any, locale, aiContent: await getAiContentEntryDb(env, tenantId, settings, 'cities', cityRow.slug), image: imageStore.cities[cityRow.slug], pageContact, searchCities: searchCities as any, siteProfile })
  const cityWebPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: siteUrl + '/city/' + slug,
    about: { '@type': 'City', name: cityRow.name },
  }
  return c.html(renderLayout({
    title: cityMeta.title,
    description: cityMeta.description,
    keywords,
    siteUrl, siteName, canonical: `${siteUrl}/city/${slug}`, locale, currentPath: `/city/${slug}`,
    cspNonce,
    image: imageStore.cities[cityRow.slug]?.url,
    imageAlt: imageStore.cities[cityRow.slug]?.alt || cityRow.name,
    breadcrumbs: crumbs(locale, [t(locale, 'city.list_title'), '/city'], [String(cityRow.name || '').slice(0, 60), `/city/${slug}`]),
    extraJsonLd: [cityWebPageJsonLd],
    ...buildLayoutChrome(settings, locale),
  }, body))
})

publicRoutes.get('/city/:citySlug/:serviceSlug', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  c.executionCtx.waitUntil(trackPageView(env))
  const { citySlug, serviceSlug } = c.req.param()
  const settings = await getSettings(env, tenantId)
  const externalUrl = getServiceExternalLinks(settings)[serviceSlug] || ''
  if (externalUrl) return c.redirect(externalUrl, 302)
  const { sql: citySql, params: cityParams } = scoped('SELECT * FROM cities WHERE slug = ?', tenantId)
  const city = await env.DB.prepare(citySql).bind(...cityParams, citySlug).first()
  const { sql: serviceSql, params: serviceParams } = scoped('SELECT * FROM services WHERE slug = ?', tenantId)
  const service = await env.DB.prepare(serviceSql).bind(...serviceParams, serviceSlug).first()
  if (!city || !service) return c.notFound()
  const cityRow = city as any, serviceRow = service as any
  if (Number(cityRow.is_active || 0) !== 1 || Number(serviceRow.is_active || 0) !== 1) return c.notFound()
  const imageStore = getImageStore(settings)
  const globalContacts = getContactMethods(settings)
  const pageContact = getPageContact(settings, 'landing:' + citySlug + '-' + serviceSlug, globalContacts)
  const title = serviceRow.seo_title
    ? `${cityRow.name}${serviceRow.seo_title}`
    : `${cityRow.name}${serviceRow.name} - ${(settings.site_name || env.SITE_NAME || '网站内容平台')}`
  const description = serviceRow.seo_description || `${cityRow.name}${serviceRow.name}服务，${serviceRow.summary || ''}`
  const keywords = serviceRow.seo_keywords || `${cityRow.name}${serviceRow.name}`
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const landingMeta = renderSeoMeta(settings, siteName, {
    title,
    description,
    keyword: serviceRow.seo_keywords || `${cityRow.name}${serviceRow.name}`,
    serviceName: serviceRow.name,
    cityName: cityRow.name,
  })
  const { sql: keywordSql, params: keywordParams } = scoped('SELECT opportunity_score FROM keywords WHERE city_id=? AND service_id=? AND COALESCE(opportunity_score,0)>=65 LIMIT 1', tenantId)
  const keywordRow = await env.DB.prepare(keywordSql).bind(...keywordParams, cityRow.id, serviceRow.id).first() as any
  if (!keywordRow) return c.notFound()

  const landingKey = `${citySlug}-${serviceSlug}`
  const siteProfile = getSiteProfile(settings, env.SITE_NAME || '')
  const { sql: relatedArticlesSql, params: relatedArticlesParams } = scoped("SELECT id, title, slug, summary, category, published_at FROM articles WHERE status='published' AND city_id = ? AND service_id = ? ORDER BY published_at DESC LIMIT 6", tenantId)
  const relatedArticles = (await env.DB.prepare(relatedArticlesSql).bind(...relatedArticlesParams, cityRow.id, serviceRow.id).all()).results
  const body = renderCityServicePage({ city: city as any, service: service as any, locale, aiContent: await getAiContentEntryDb(env, tenantId, settings, 'landing', landingKey), image: imageStore.cities[citySlug] || imageStore.services[serviceSlug], pageContact, relatedArticles: relatedArticles as any, siteProfile })
  const serviceSchemas = [{
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: serviceRow.name,
    description: serviceRow.seo_description || serviceRow.summary || '',
    provider: { '@type': 'Organization', name: settings.site_name || env.SITE_NAME || '网站内容平台', url: siteUrl },
    areaServed: [{ '@type': 'City', name: cityRow.name }],
    url: siteUrl + '/city/' + citySlug + '/' + serviceSlug,
    image: (imageStore.cities[citySlug] || imageStore.services[serviceSlug])?.url ? [absoluteUrl(siteUrl, String((imageStore.cities[citySlug] || imageStore.services[serviceSlug])?.url))] : undefined,
  }]
  return c.html(renderLayout({
    title: landingMeta.title,
    description: landingMeta.description,
    keywords,
    siteUrl, siteName, canonical: `${siteUrl}/city/${citySlug}/${serviceSlug}`,
    locale, currentPath: `/city/${citySlug}/${serviceSlug}`,
    cspNonce,
    image: (imageStore.cities[citySlug] || imageStore.services[serviceSlug])?.url,
    breadcrumbs: crumbs(locale,
      [t(locale, 'city.list_title'), '/city'],
      [String(cityRow.name || ''), `/city/${citySlug}`],
      [`${cityRow.name}${serviceRow.name}`, `/city/${citySlug}/${serviceSlug}`],
    ),
    extraJsonLd: serviceSchemas,
    ...buildLayoutChrome(settings, locale),
  }, body))
})

// /article/ 统一收敛到规范地址，避免尾斜杠进入参数路由。
async function loadArticleCategoryMenu(env: Bindings, tenantId: number) {
  const { sql, params } = scoped("SELECT category FROM articles WHERE status='published' AND category IS NOT NULL AND category <> '' LIMIT 200", tenantId)
  const rows = (await env.DB.prepare(sql).bind(...params).all()).results as Array<{ category?: string }>
  return articleCategoryMenu(rows)
}

// ---- 成功案例 ----
// 案例是独立内容类型：前台 /case 列表 + /case/{slug} 详情。
// 城市页 /city/... 保持不变，继续用于本地搜索收录。
publicRoutes.get('/case', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  c.executionCtx.waitUntil(trackPageView(env))
  const settings = await getSettings(env, tenantId)
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  // 案例列表页和城市页一样受「前台页面」管理：可隐藏、可指向外部地址、可改标题。
  const casePage = getPageSettings(settings).cases
  if (casePage.mode === 'hidden') return c.notFound()
  if (casePage.mode === 'external' && casePage.externalUrl) return c.redirect(casePage.externalUrl, 302)
  const rows = await getPublicCases(env, tenantId)
  // 行业筛选:?industry=xxx 时只展示该行业案例;筛选项始终来自全部案例,避免筛完只剩一个选项。
  const allIndustries = Array.from(new Set(rows.map((row) => String(row.industry || '').trim()).filter(Boolean)))
  const industryFilter = String(c.req.query('industry') || '').trim()
  const filteredRows = industryFilter ? rows.filter((row) => String(row.industry || '').trim() === industryFilter) : rows
  const listTitle = (locale === 'zh-CN' ? casePage.titleZh : casePage.titleEn)
    || (locale === 'zh-CN' ? casePage.labelZh : casePage.labelEn)
    || (locale === 'zh-CN' ? '成功案例' : 'Case studies')
  const listSubtitle = locale === 'zh-CN' ? casePage.subtitleZh : casePage.subtitleEn
  const title = listTitle + ' - ' + siteName
  const description = listSubtitle || (locale === 'zh-CN'
    ? `已交付 ${rows.length} 个项目的真实案例，每个案例都包含项目挑战、解决方案与可验证的成果数据。`
    : `${rows.length} delivered projects, each with the challenge, the approach, and measurable results.`)
  const keywords = rows
    .slice(0, 8)
    .flatMap((row) => [row.industry, row.service_name])
    .filter(Boolean)
    .join(',')
  const caseMeta = renderSeoMeta(settings, siteName, {
    title,
    description,
    keyword: keywords,
  })
  // ItemList 帮助 AI 引擎与搜索引擎理解「这是一个案例集合」，而不是零散页面。
  const itemListJsonLd = rows.length
    ? [{
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: listTitle,
        numberOfItems: rows.length,
        itemListElement: rows.slice(0, 20).map((row, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: siteUrl + casePublicPath(row.slug),
          name: caseDisplayTitle(row),
        })),
      }]
    : []
  // 标题/副标题/补充正文与「前台显示留言表单」都在「前台页面 → 成功案例」里配置，
  // 模板按受管列表页的统一版式渲染（hero h1 + 卡片区 + 表单区 + 固定内容区），
  // 保存后前台立即生效。
  const body = renderCaseList(filteredRows, locale, casePage, {
    turnstileSiteKey: String(settings.turnstile_site_key || ''),
    industries: allIndustries,
    currentIndustry: industryFilter,
  })
  return c.html(renderLayout({
    title: caseMeta.title,
    description: caseMeta.description,
    keywords,
    siteUrl, siteName, canonical: `${siteUrl}/case`, locale, currentPath: '/case',
    cspNonce,
    breadcrumbs: crumbs(locale, [listTitle, '/case']),
    extraJsonLd: itemListJsonLd,
    ...buildLayoutChrome(settings, locale),
  }, body))
})

publicRoutes.get('/case/:slug', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  c.executionCtx.waitUntil(trackPageView(env))
  const slug = c.req.param('slug')
  // 案例页被整体设为「隐藏」时，详情页同步下线：否则详情页里的「返回案例列表」
  // 会指向一个 404 的 /case，留下指向不存在页面的内部链接。
  const settings = await getSettings(env, tenantId)
  if (getPageSettings(settings).cases.mode === 'hidden') return c.notFound()
  const row = await getCaseBySlug(env, tenantId, slug)
  if (!row || !isCasePublic(row)) return c.notFound()
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const title = caseDisplayTitle(row)
  const related = (await getPublicCases(env, tenantId, 8)).filter((item) => item.slug !== row.slug).slice(0, 3)
  const body = renderCasePage({ row, locale, related })
  const seoTitle = String(row.seo_title || '').trim() || (title + '案例 - ' + siteName)
  const description = String(row.seo_description || '').trim() || String(row.summary || '').trim() || (title + '项目的完整交付案例，包含挑战、方案与成果数据。')
  const keywords = String(row.seo_keywords || '').trim() || [row.industry, row.service_name, row.region].filter(Boolean).join(',')
  const caseDetailMeta = renderSeoMeta(settings, siteName, {
    title: seoTitle,
    description,
    keyword: keywords,
    serviceName: String(row.service_name || ''),
    cityName: String(row.region || ''),
  })
  const articleJsonLd = buildCaseJsonLd({
    siteName, siteUrl, slug: String(row.slug), title: seoTitle, description,
    clientName: String(row.client_name || ''),
    industry: String(row.industry || ''),
    serviceName: String(row.service_name || ''),
    region: String(row.region || ''),
    imageUrl: row.cover_image_url ? absoluteUrl(siteUrl, String(row.cover_image_url)) : undefined,
    publishedAt: String(row.created_at || '').slice(0, 10) || undefined,
    modifiedAt: String(row.updated_at || '').slice(0, 10) || undefined,
    projectUrl: String(row.project_url || '').trim() || undefined,
  })
  return c.html(renderLayout({
    title: caseDetailMeta.title,
    description: caseDetailMeta.description,
    keywords,
    siteUrl, siteName, canonical: `${siteUrl}/case/${slug}`, locale, currentPath: `/case/${slug}`,
    cspNonce,
    image: String(row.cover_image_url || '').trim() || undefined,
    imageAlt: title,
    ogType: 'article',
    publishedTime: String(row.created_at || '') || undefined,
    modifiedTime: String(row.updated_at || '') || undefined,
    breadcrumbs: crumbs(locale, [t(locale, 'pages.cases'), '/case'], [title.slice(0, 60), `/case/${slug}`]),
    extraJsonLd: [articleJsonLd],
    ...buildLayoutChrome(settings, locale),
  }, body))
})

publicRoutes.get('/article/', (c) => c.redirect('/article', 301))

publicRoutes.get('/article', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  c.executionCtx.waitUntil(trackPageView(env))
  const category = String(c.req.query('category') || '').trim().slice(0, 80)
  let articles: any[] = []
  try {
    const baseSql = category
      ? "SELECT id, title, slug, summary, substr(content, 1, 600) AS content_excerpt, category, published_at FROM articles WHERE status='published' AND category=? ORDER BY published_at DESC LIMIT 30"
      : "SELECT id, title, slug, summary, substr(content, 1, 600) AS content_excerpt, category, published_at FROM articles WHERE status='published' ORDER BY published_at DESC LIMIT 30"
    const { sql, params } = scoped(baseSql, tenantId)
    const bindParams = category ? [...params, category] : params
    const result = await env.DB.prepare(sql).bind(...bindParams).all()
    articles = result.results as any[]
  } catch (e) {
    // 资讯查询异常时给出可渲染的空列表，避免全站统一 500。
    safeError('D1 articles list read failed', e)
  }
  const settings = await getSettings(env, tenantId)
  const page = getPageSettings(settings).articles
  const globalContacts = getContactMethods(settings)
  const pageContact = getPageContact(settings, 'articles', globalContacts)
  if (page.mode === 'hidden') return c.notFound()
  if (page.mode === 'external' && page.externalUrl) return c.redirect(page.externalUrl, 302)
  const subprojects = await getActiveSubprojects(env, 'article', tenantId)
  const siteProfile = getSiteProfile(settings, env.SITE_NAME || '')
  const body = renderArticleList(articles, locale, page, subprojects, siteProfile)
  const title = (locale === 'zh-CN' ? page.titleZh : page.titleEn) || (locale === 'zh-CN' ? page.labelZh : page.labelEn)
  const description = (locale === 'zh-CN' ? page.subtitleZh : page.subtitleEn) || (
    siteProfile.topic
      ? ('围绕' + siteProfile.topic + '持续更新相关动态、实务信息与解决方案。')
      : (locale === 'zh-CN' ? '持续更新已发布的资讯与实务内容。' : 'Latest published insights and practical information.')
  )
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const articleListMeta = renderSeoMeta(settings, siteName, {
    title,
    description,
    keyword: page.labelZh + ',' + page.labelEn,
  })
  return c.html(renderLayout({
    title: articleListMeta.title,
    description: articleListMeta.description,
    keywords: page.labelZh + ',' + page.labelEn,
    siteUrl, siteName, canonical: `${siteUrl}/article`, locale, currentPath: '/article',
    cspNonce,
    breadcrumbs: crumbs(locale, [title, '/article']),
    ...buildLayoutChrome(settings, locale),
    articleCategories: await loadArticleCategoryMenu(env, tenantId),
  }, body))
})


publicRoutes.get('/article/category/:name', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  // Hono 的 c.req.param 已经 URL-decode 过，不再二次 decodeURIComponent，
  // 避免类别名中含无效转义序列（如 "100%zz"）时抛出未捕获的 URIError 导致 500。
  const name = String(c.req.param('name') || '').trim().slice(0, 30)
  if (!name) return c.notFound()
  const { sql, params } = scoped("SELECT id, title, slug, summary, category, published_at FROM articles WHERE status='published' AND category = ? ORDER BY published_at DESC LIMIT 60", tenantId)
  const articles = (await env.DB.prepare(sql).bind(...params, name).all()).results as any[]
  if (!articles.length) return c.notFound()
  const settings = await getSettings(env, tenantId)
  const subprojects = await getActiveSubprojects(env, 'article', tenantId)
  const siteProfile = getSiteProfile(settings, env.SITE_NAME || '')
  const globalContacts = getContactMethods(settings)
  const body = renderArticleList(articles as any, locale, getPageSettings(settings).articles, subprojects, siteProfile)
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const title = name + ' - ' + siteName
  const description = name + '相关资讯'
  const articleCategoryMeta = renderSeoMeta(settings, siteName, {
    title,
    description,
    keyword: name,
  })
  return c.html(renderLayout({
    title: articleCategoryMeta.title,
    description: articleCategoryMeta.description,
    keywords: name,
    siteUrl, siteName, canonical: siteUrl + '/article/category/' + encodeURIComponent(name),
    locale, currentPath: '/article/category/' + encodeURIComponent(name),
    cspNonce,
    breadcrumbs: crumbs(locale, [t(locale, 'article.insights'), '/article'], [name, '/article/category/' + encodeURIComponent(name)]),
    ...buildLayoutChrome(settings, locale, getContactMethods(settings)),
    articleCategories: await loadArticleCategoryMenu(env, tenantId),
  }, body))
})

publicRoutes.get('/article/tag/:slug', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  const slug = c.req.param('slug')
  const data = await getSubprojectWithItems(env, 'article', slug, tenantId)
  if (!data) return c.notFound()
  const settings = await getSettings(env, tenantId)
  const pageTitle = locale === 'zh-CN' ? (data.project.seo_title_zh || data.project.title_zh || data.project.label_zh) : (data.project.seo_title_en || data.project.title_en || data.project.label_en || data.project.label_zh)
  const description = locale === 'zh-CN' ? (data.project.seo_description_zh || data.project.subtitle_zh || '') : (data.project.seo_description_en || data.project.subtitle_en || '')
  const keywords = locale === 'zh-CN' ? data.project.seo_keywords_zh : data.project.seo_keywords_en
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const tagMeta = renderSeoMeta(settings, siteName, {
    title: pageTitle,
    description,
    keyword: keywords || '',
  })
  const body = renderSubprojectPage({ section: 'article', subproject: data.project, items: data.items, locale })
  return c.html(renderLayout({
    title: tagMeta.title,
    description: tagMeta.description,
    keywords, siteUrl, siteName,
    canonical: siteUrl + '/article/tag/' + slug, locale, currentPath: '/article/tag/' + slug,
    cspNonce,
    ...buildLayoutChrome(settings, locale, getContactMethods(settings)),
    articleCategories: await loadArticleCategoryMenu(env, tenantId),
  }, body))
})

publicRoutes.get('/new', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  const { sql, params } = scoped("SELECT id, title, slug, summary, category, published_at FROM articles WHERE status='published' ORDER BY published_at DESC LIMIT 30", tenantId)
  const articles = (await env.DB.prepare(sql).bind(...params).all()).results
  const settings = await getSettings(env, tenantId)
  const subprojects = await getActiveSubprojects(env, 'new', tenantId)
  const siteProfile = getSiteProfile(settings, env.SITE_NAME || '')
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const body = renderNewList(articles as any, subprojects, locale, siteProfile)
  const newTitle = (locale === 'zh-CN'
    ? (siteProfile.topic ? siteProfile.topic + '新闻专题' : '新闻专题')
    : (siteProfile.topic ? siteProfile.topic + ' news topics' : 'News topics')) + ' - ' + siteName
  const newDesc = siteProfile.topic
    ? (locale === 'zh-CN' ? siteProfile.topic + '相关专题、实务信息与解决方案。' : 'Topics, practical information and solutions about ' + siteProfile.topic + '.')
    : (locale === 'zh-CN' ? '已发布的专题与实务信息。' : 'Published topic and practical information.')
  const newMeta = renderSeoMeta(settings, siteName, {
    title: newTitle,
    description: newDesc,
    keyword: siteProfile.primaryKeywords.slice(0, 5).join(','),
  })
  return c.html(renderLayout({
    title: newMeta.title,
    description: newMeta.description,
    keywords: siteProfile.primaryKeywords.slice(0, 5).join(','),
    siteUrl, siteName, canonical: siteUrl + '/new', locale, currentPath: '/new',
    cspNonce,
    ...buildLayoutChrome(settings, locale, getContactMethods(settings)),
  }, body))
})

publicRoutes.get('/new/:slug', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  const slug = c.req.param('slug')
  const data = await getSubprojectWithItems(env, 'new', slug, tenantId)
  if (!data) return c.notFound()
  const settings = await getSettings(env, tenantId)
  const pageTitle = locale === 'zh-CN' ? (data.project.seo_title_zh || data.project.title_zh || data.project.label_zh) : (data.project.seo_title_en || data.project.title_en || data.project.label_en || data.project.label_zh)
  const description = locale === 'zh-CN' ? (data.project.seo_description_zh || data.project.subtitle_zh || '') : (data.project.seo_description_en || data.project.subtitle_en || '')
  const keywords = locale === 'zh-CN' ? data.project.seo_keywords_zh : data.project.seo_keywords_en
  const body = renderSubprojectPage({ section: 'new', subproject: data.project, items: data.items, locale })
  return c.html(renderLayout({
    title: pageTitle + ' - ' + (settings.site_name || env.SITE_NAME || '网站内容平台'),
    description, keywords, siteUrl, siteName: settings.site_name || env.SITE_NAME || '网站内容平台',
    canonical: siteUrl + '/new/' + slug, locale, currentPath: '/new/' + slug,
    cspNonce,
    ...buildLayoutChrome(settings, locale, getContactMethods(settings)),
  }, body))
})

publicRoutes.get('/article/:slugOrId', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  const slugOrId = String(c.req.param('slugOrId') || '').trim()

  const { sql, params } = scoped(/^\d+$/.test(slugOrId)
    ? "SELECT * FROM articles WHERE id = ? AND status='published'"
    : "SELECT * FROM articles WHERE slug = ? AND status='published'", tenantId)
  const article = await env.DB.prepare(sql).bind(...params, /^\d+$/.test(slugOrId) ? Number(slugOrId) : slugOrId).first()
  if (!article) return c.notFound()

  const art = article as any
  const storedSlug = String(art.slug || '').trim().replace(/^\/+|\/+$/g, '')
  // 历史文章可能没有 slug：这类文章直接使用 /article/{id}，不能重定向到一个尚未写入 D1 的虚拟 slug。
  const publicSlug = storedSlug || String(art.id)
  if (storedSlug && slugOrId !== storedSlug) {
    return c.redirect('/article/' + encodeURIComponent(storedSlug), 301)
  }
  if (shouldSampleView()) {
    const { sql: updateSql, params: updateParams } = scoped('UPDATE articles SET views = views + 1 WHERE id = ?', tenantId)
    c.executionCtx.waitUntil(env.DB.prepare(updateSql).bind(...updateParams, art.id).run())
    c.executionCtx.waitUntil(trackPageView(env, true))
  }
  const settings = await getSettings(env, tenantId)
  const globalContacts = getContactMethods(settings)
  const pageContact = getPageContact(settings, 'article:' + art.id, globalContacts)
  const body = renderArticlePage({ ...art, summary: art.summary, seo_keywords: art.seo_keywords }, locale)
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const publishedIso = toDateTimeAttr(art.published_at || art.created_at)
  const modifiedIso = toDateTimeAttr(art.updated_at || art.published_at || art.created_at)
  const articleAuthorName = String(settings.site_author_name || '').trim()
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: art.seo_title || art.title,
    description: art.seo_description || art.summary || '',
    // schema.org 要求 ISO 8601；SQLite 的 "YYYY-MM-DD HH:MM:SS" 需要补上 T 分隔符。
    ...(publishedIso ? { datePublished: publishedIso } : {}),
    ...(modifiedIso ? { dateModified: modifiedIso } : {}),
    // 配置了署名作者时输出 Person（E-E-A-T 关键信号），否则退回组织署名。
    author: articleAuthorName
      ? { '@type': 'Person', name: articleAuthorName }
      : { '@type': 'Organization', name: siteName },
    publisher: { '@type': 'Organization', name: siteName },
    keywords: String(art.seo_keywords || '').split(/[,，;；、\n]+/).map((v: string) => v.trim()).filter(Boolean).slice(0, 5),
    mainEntityOfPage: `${siteUrl}/article/${publicSlug}`,
    ...(art.cover_image ? { image: [absoluteUrl(siteUrl, String(art.cover_image))] } : {}),
  }
  const faqJsonLd = faqPageJsonLd(parseArticleFaq(art.faq_json))
  const articleTitle = art.seo_title || `${art.title} - ${siteName}`
  const articleDesc = art.seo_description || art.summary || ''
  const articleMeta = renderSeoMeta(settings, siteName, {
    title: articleTitle,
    description: articleDesc,
    keyword: art.seo_keywords || '',
    serviceName: art.seo_keywords || '',
  })
  return c.html(renderLayout({
    title: articleMeta.title,
    description: articleMeta.description,
    keywords: art.seo_keywords || '',
    siteUrl, siteName, canonical: `${siteUrl}/article/${publicSlug}`, locale, currentPath: `/article/${publicSlug}`,
    cspNonce,
    ogType: 'article',
    publishedTime: publishedIso,
    modifiedTime: modifiedIso,
    image: art.cover_image ? String(art.cover_image) : undefined,
    breadcrumbs: crumbs(locale, [t(locale, 'article.insights'), '/article'], [String(art.title || '').slice(0, 60), `/article/${publicSlug}`]),
    extraJsonLd: [articleJsonLd, ...(faqJsonLd ? [faqJsonLd] : [])],
    ...buildLayoutChrome(settings, locale),
  }, body))
})

// ---- 关于我们 ----
publicRoutes.get('/about', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  const settings = await getSettings(env, tenantId)
  const pageSettings = getPageSettings(settings)
  const aboutPage = pageSettings.about
  const pageContact = getPageContact(settings, 'about', getContactMethods(settings))
  if (aboutPage.mode === 'hidden') return c.notFound()
  if (aboutPage.mode === 'external' && aboutPage.externalUrl) return c.redirect(aboutPage.externalUrl, 302)
  const contactMessage = c.req.query('sent') === '1' ? t(locale, 'contact.success') : ''
  const body = renderAboutPage(settings, (settings.site_name || env.SITE_NAME || '网站内容平台'), locale, aboutPage)
  const aboutTitle = aboutPage.titleZh || aboutPage.titleEn || t(locale, 'about.title')
  const aboutSubtitle = aboutPage.subtitleZh || aboutPage.subtitleEn || settings.site_description || ''
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const aboutMeta = renderSeoMeta(settings, siteName, {
    title: `${aboutTitle} - ${siteName}`,
    description: aboutSubtitle,
    keyword: (locale === 'zh-CN' ? aboutPage.seoKeywordsZh : aboutPage.seoKeywordsEn) || settings.site_keywords,
  })
  return c.html(renderLayout({
    title: aboutMeta.title,
    description: aboutMeta.description,
    keywords: (locale === 'zh-CN' ? aboutPage.seoKeywordsZh : aboutPage.seoKeywordsEn) || settings.site_keywords,
    siteUrl, siteName: (settings.site_name || env.SITE_NAME || '网站内容平台'), canonical: `${siteUrl}/about`, locale, currentPath: '/about',
    cspNonce,
    breadcrumbs: crumbs(locale, [aboutTitle, '/about']),
    ...buildLayoutChrome(settings, locale),
  }, body))
})

// ---- 联系我们：前台表单 + D1 留言 ----
publicRoutes.get('/contact', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  let settings: Record<string, string> = {}
  try {
    settings = await getSettings(env, tenantId)
  } catch (e) {
    safeError('contact GET settings read failed', e)
  }
  const pageSettings = getPageSettings(settings)
  const contactPage = pageSettings.contact
  const pageContact = getPageContact(settings, 'contact', getContactMethods(settings))
  if (contactPage.mode === 'hidden') return c.notFound()
  if (contactPage.mode === 'external' && contactPage.externalUrl) return c.redirect(contactPage.externalUrl, 302)
  const message = c.req.query('sent') === '1'
    ? t(locale, 'contact.success')
    : c.req.query('error') === 'phone'
      ? t(locale, 'contact.phone_required')
      : c.req.query('error') === 'utm'
        ? t(locale, 'contact.utm_rejected')
        : ''
  let body = ''
  try {
    body = renderContactPage(settings, locale, message, contactPage, pageContact)
  } catch (e) {
    safeError('contact page render failed', e)
    body = `<div class="card" style="border-left:4px solid #e5484d;color:#e5484d">${t(locale, 'contact.error_load')}</div>`
  }
  const contactTitle = locale === 'zh-CN' ? contactPage.titleZh : contactPage.titleEn
  const contactSubtitle = locale === 'zh-CN' ? contactPage.subtitleZh : contactPage.subtitleEn
  const siteName = settings.site_name || env.SITE_NAME || '网站内容平台'
  const contactMeta = renderSeoMeta(settings, siteName, {
    title: `${contactTitle || t(locale, 'contact.title')} - ${siteName}`,
    description: contactSubtitle || t(locale, 'contact.subtitle'),
    keyword: (locale === 'zh-CN' ? contactPage.seoKeywordsZh : contactPage.seoKeywordsEn) || settings.site_keywords,
  })
  return c.html(renderLayout({
    title: contactMeta.title,
    description: contactMeta.description,
    keywords: (locale === 'zh-CN' ? contactPage.seoKeywordsZh : contactPage.seoKeywordsEn) || settings.site_keywords,
    siteUrl, siteName, canonical: `${siteUrl}/contact`, locale, currentPath: '/contact',
    cspNonce,
    breadcrumbs: crumbs(locale, [contactTitle || t(locale, 'contact.title'), '/contact']),
    ...buildLayoutChrome(settings, locale),
  }, body))
})

publicRoutes.post('/contact', rateLimit(8, 60, 'contact'), async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const body = await c.req.parseBody()
  const settings = await getSettings(env, tenantId)
  // Turnstile:已配置时校验,未配置自动跳过;网络超时不应导致 502/503,降级为跳过
  let ts: TurnstileResult = { valid: true, skipped: true }
  try {
    ts = await verifyTurnstile(env, getTenantId(c), String(body['cf-turnstile-response'] || ''), c.req.header('cf-connecting-ip'))
  } catch (e) {
    safeError('contact turnstile verify failed, skipping', e)
  }
  if (!ts.valid) return c.redirect('/contact?error=spam')
  // 隐藏字段为简单反垃圾蜜罐，正常访客不会填写。
  if (String(body.website || '').trim()) {
    return c.redirect('/contact?sent=1')
  }
  const safeName = String(body.name || '').trim().slice(0, 100)
  const safePhone = String(body.phone || '').trim().slice(0, 50)
  const safeEmail = String(body.email || '').trim().toLowerCase().slice(0, 254)
  if (safeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) return c.redirect('/contact?error=email')
  const safeCity = String(body.city || '').trim().slice(0, 100)
  const safeService = String(body.service || '').trim().slice(0, 100)
  const safeContent = String(body.content || '').trim().slice(0, 2000)
  const safeUtmSource = String(body.utm_source || '').trim().slice(0, 100)
  const safeUtmMedium = String(body.utm_medium || '').trim().slice(0, 100)
  const safeUtmCampaign = String(body.utm_campaign || '').trim().slice(0, 100)
  const safeUtmTerm = String(body.utm_term || '').trim().slice(0, 100)
  const safeUtmContent = String(body.utm_content || '').trim().slice(0, 100)
  if (!safePhone) return c.redirect('/contact?error=phone')
  // UTM 来源白名单：配置后，utm_source 不在其中时拒绝提交（防止恶意伪造来源）
  if (!isUtmSourceAllowed(safeUtmSource, settings.site_utm_source_whitelist || '')) {
    return c.redirect('/contact?error=utm')
  }
  try {
    await env.DB.prepare(
      'INSERT INTO messages (name, phone, email, city, service, content, utm_source, utm_medium, utm_campaign, utm_term, utm_content, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(safeName, safePhone, safeEmail, safeCity, safeService, safeContent, safeUtmSource, safeUtmMedium, safeUtmCampaign, safeUtmTerm, safeUtmContent, tenantId).run()
  } catch (e) {
    safeError('public contact message insert failed', e)
    return c.text('留言暂时提交失败，请稍后再试。', 503)
  }
  return c.redirect('/contact?sent=1')
})

// ---- 搜索：同时匹配 服务 / 城市 / 资讯 ----
publicRoutes.get('/search', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteUrl = await resolveSiteUrl(c)
  const locale = c.get('locale')
  const cspNonce = (c as any).get("cspNonce") || ""
  const q = c.req.query('q') || ''
  const selectedCity = c.req.query('city') || ''
  const settings = await getSettings(env, tenantId)
  let cities: any[] = [], services: any[] = [], articles: any[] = []
  if (q || selectedCity) {
    const like = `%${escapeLike(q)}%`
    const cityParams = selectedCity ? [selectedCity] : []
    const { sql: cityRowSql, params: cityRowParams } = scoped('SELECT id, name, slug, province FROM cities WHERE is_active=1 AND slug=? LIMIT 1', tenantId)
    const cityRow = selectedCity
      ? await env.DB.prepare(cityRowSql).bind(...cityRowParams, selectedCity).first()
      : null
    const citySearchSql = q
      ? `SELECT id, name, slug, province FROM cities WHERE is_active=1 AND name LIKE ? ESCAPE char(92)${selectedCity ? ' AND slug=?' : ''} LIMIT 10`
      : ''
    const { sql: citiesSql, params: citiesParams } = scoped(citySearchSql, tenantId)
    const citiesBindParams = q ? [...citiesParams, like, ...cityParams] : citiesParams
    const citiesResult = q ? await env.DB.prepare(citiesSql).bind(...citiesBindParams).all() : { results: cityRow ? [cityRow] : [] }
    cities = citiesResult.results as any[]

    const { sql: servicesSql, params: servicesParams } = scoped(`SELECT id, name, slug, icon, summary FROM services WHERE is_active=1 AND name LIKE ? ESCAPE char(92) LIMIT 10`, tenantId)
    services = q
      ? (await env.DB.prepare(servicesSql).bind(...servicesParams, like).all()).results as any[]
      : []

    const articlesSearchSql = q
      ? `SELECT a.id, a.title, a.slug, a.summary, a.category, a.published_at FROM articles a WHERE a.status='published' AND (a.title LIKE ? ESCAPE char(92) OR a.summary LIKE ? ESCAPE char(92))${selectedCity ? ' AND a.city_id = (SELECT id FROM cities WHERE slug=? AND is_active=1 AND tenant_id=?)' : ''} ORDER BY a.published_at DESC LIMIT 20`
      : ''
    const { sql: articlesSql, params: articlesParams } = scoped(articlesSearchSql, tenantId)
    const articlesBindParams = q ? [...articlesParams, like, like, ...(selectedCity ? [selectedCity, tenantId] : [])] : articlesParams
    articles = q
      ? (await env.DB.prepare(articlesSql).bind(...articlesBindParams).all()).results as any[]
      : []
  }
  const body = renderSearchResults({ q, cities, services, articles, locale })
  const query = new URLSearchParams()
  if (q) query.set('q', q)
  if (selectedCity) query.set('city', selectedCity)
  const queryString = query.toString()
  return c.html(renderLayout({
    title: `"${q}"的搜索结果 - ${(settings.site_name || env.SITE_NAME || '网站内容平台')}`,
    siteUrl, siteName: (settings.site_name || env.SITE_NAME || '网站内容平台'), canonical: `${siteUrl}/search${queryString ? '?' + queryString : ''}`, robots: 'noindex,follow',
    locale, currentPath: `/search${queryString ? '?' + queryString : ''}`,
    cspNonce,
    ...buildLayoutChrome(settings, locale, getContactMethods(settings)),
  }, body))
})

