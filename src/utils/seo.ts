import { safeError, safeWarn } from './safeLogger'
import type { Bindings } from '../types'
import { submitGoogleIndexing } from './googleIndexing'
import { getSystemSecret } from './systemSecrets'
import { MIN_INDEXABLE_OPPORTUNITY_SCORE } from './keywordScore'
import { SettingsStore } from './settingsStore'

async function getSetting(env: Bindings, key: string, tenantId = 1): Promise<string | null> {
  const value = await SettingsStore.forTenant(env, tenantId).get(key)
  return value || null
}

export type SitemapEntry = { loc: string; lastmod?: string }

const MANAGED_PAGE_PATHS: Record<string, string> = {
  home: '/', services: '/service', cases: '/case', cities: '/city', articles: '/article', about: '/about', contact: '/contact',
}

/**
 * 受管页面（「前台页面」）的生效模式：internal / external / hidden。
 * 配置读取或解析失败时全部按 internal 处理，避免 Sitemap 因后台配置异常而变空。
 */
async function getManagedPageModes(env: Bindings, tenantId = 1): Promise<Record<string, string>> {
  const modes: Record<string, string> = {}
  for (const key of Object.keys(MANAGED_PAGE_PATHS)) modes[key] = 'internal'
  try {
    const value = await SettingsStore.forTenant(env, tenantId).get('page_settings_json')
    const raw = value ? JSON.parse(String(value)) : {}
    for (const key of Object.keys(modes)) {
      const mode = raw?.[key]?.mode
      if (mode === 'hidden' || mode === 'external') modes[key] = mode
    }
  } catch {
    // 忽略：保持 internal 默认值
  }
  return modes
}

export async function getSitemapEntries(env: Bindings, tenantId: number, siteUrlOverride?: string): Promise<SitemapEntry[]> {
  const site = String(siteUrlOverride ?? env.SITE_URL ?? '').trim().replace(/\/$/, '')
  if (!site) return []
  const t = Number(tenantId) || 1
  const pageModes = await getManagedPageModes(env, t)
  const visiblePaths = new Set<string>()
  for (const [key, path] of Object.entries(MANAGED_PAGE_PATHS)) {
    if (pageModes[key] === 'internal') visiblePaths.add(path)
  }
  const entries: SitemapEntry[] = []
  const latestArticle = await env.DB.prepare(
    "SELECT MAX(COALESCE(updated_at, published_at, created_at)) AS lastmod FROM articles WHERE status='published' AND tenant_id = ?"
  ).bind(t).first() as any
  const latestContentLastmod = latestArticle && latestArticle.lastmod ? String(latestArticle.lastmod) : undefined

  const addStatic = (path: string, lastmod?: string) => {
    if (visiblePaths.has(path)) entries.push({ loc: site + path, lastmod })
  }

  // 首页包含最新文章，因此只有首页和文章列表可以可靠地使用“最新文章更新时间”。
  addStatic('/', latestContentLastmod)
  addStatic('/service')
  addStatic('/case')
  addStatic('/city')
  addStatic('/article', latestContentLastmod)
  addStatic('/about')
  addStatic('/contact')

  const cities = (await env.DB.prepare(
    'SELECT slug FROM cities WHERE is_active = 1 AND tenant_id = ? ORDER BY sort_order LIMIT 200'
  ).bind(t).all()).results as any[]
  // 案例页整体设为「隐藏」时，案例详情页同样返回 404（见 src/routes/public.ts），
  // 因此这些地址也不进入 Sitemap，避免收录一批打不开的页面。
  const caseRows = pageModes.cases === 'hidden'
    ? []
    : (await env.DB.prepare(
        'SELECT slug, updated_at FROM cases WHERE is_active = 1 AND tenant_id = ? ORDER BY is_featured DESC, sort_order, id LIMIT 500'
      ).bind(t).all()).results as any[]
  const services = (await env.DB.prepare(
    'SELECT id, slug FROM services WHERE is_active = 1 AND tenant_id = ? ORDER BY sort_order LIMIT 50'
  ).bind(t).all()).results as any[]

  let externalServiceLinks: Record<string, string> = {}
  try {
    const value = await SettingsStore.forTenant(env, tenantId).get('service_external_links')
    const raw = value ? JSON.parse(String(value)) : {}
    if (raw && typeof raw === 'object') {
      externalServiceLinks = Object.fromEntries(
        Object.entries(raw as Record<string, unknown>)
          .filter(([, value]) => typeof value === 'string' && String(value).trim())
          .map(([key, value]) => [key, String(value).trim()])
      )
    }
  } catch {
    externalServiceLinks = {}
  }
  const isExternalService = (service: any) =>
    !!(externalServiceLinks[String(service.slug)] || externalServiceLinks[String(service.id)])

  // 只把实际由本站渲染的服务页放入 Sitemap；302 外站的服务页不进入自然收录入口。
  for (const service of services) {
    if (!isExternalService(service)) entries.push({ loc: site + '/service/' + service.slug })
  }
  for (const city of cities) entries.push({ loc: site + '/city/' + city.slug })
  for (const row of caseRows) {
    const slug = String(row.slug || '').trim()
    if (slug) entries.push({ loc: site + '/case/' + slug, lastmod: row.updated_at || undefined })
  }

  // 城市×服务页保持 1000 条上限，且排除实际会 302 到外站的服务。
  const internalServiceSlugs = new Set(services.filter((service) => !isExternalService(service)).map((service) => String(service.slug)))
  if (internalServiceSlugs.size) {
    const cityServices = (await env.DB.prepare(
      `SELECT c.slug AS city_slug, s.slug AS service_slug
       FROM keywords k
       JOIN cities c ON c.id = k.city_id AND c.tenant_id = ?
       JOIN services s ON s.id = k.service_id AND s.tenant_id = ?
       WHERE k.tenant_id = ? AND c.is_active = 1 AND s.is_active = 1 AND COALESCE(k.opportunity_score,0) >= ${MIN_INDEXABLE_OPPORTUNITY_SCORE}
       ORDER BY c.sort_order, s.sort_order LIMIT 1000`
    ).bind(t, t, t).all()).results as any[]
    for (const row of cityServices) {
      if (internalServiceSlugs.has(String(row.service_slug))) {
        entries.push({ loc: site + '/city/' + row.city_slug + '/' + row.service_slug })
      }
    }
  }

  const articles = (await env.DB.prepare(
    "SELECT slug, updated_at, published_at, created_at FROM articles WHERE status='published' AND tenant_id = ? ORDER BY id DESC LIMIT 5000"
  ).bind(t).all()).results as any[]
  for (const article of articles) {
    entries.push({
      loc: site + '/article/' + article.slug,
      lastmod: article.updated_at || article.published_at || article.created_at || undefined,
    })
  }

  // 后台启用的四类子项目自动进入 Sitemap；子项目详情页单独收录，根页面仍保留原有 canonical。
  const subprojects = (await env.DB.prepare(
    "SELECT section, slug, updated_at FROM subprojects WHERE is_active=1 AND tenant_id = ? ORDER BY section, sort_order, id LIMIT 200"
  ).bind(t).all()).results as any[]
  for (const project of subprojects) {
    const section = String(project.section || '')
    const slug = String(project.slug || '').trim()
    if (!slug) continue
    const path = section === 'service'
      ? '/service/topic/' + slug
      : section === 'article'
        ? '/article/tag/' + slug
        : section === 'new'
          ? '/new/' + slug
          : section === 'city'
            ? '/city/topic/' + slug
            : ''
    if (path) entries.push({ loc: site + path, lastmod: project.updated_at || undefined })
  }

  const deduped = new Map<string, SitemapEntry>()
  for (const entry of entries) {
    if (!deduped.has(entry.loc)) deduped.set(entry.loc, entry)
  }
  return Array.from(deduped.values())
}

export async function getAllPublishedUrls(env: Bindings, tenantId: number, siteUrlOverride?: string): Promise<string[]> {
  return (await getSitemapEntries(env, tenantId, siteUrlOverride)).map((entry) => entry.loc)
}

async function log(env: Bindings, engine: string, url: string, statusCode: number, response: string) {
  await env.DB.prepare(
    'INSERT INTO submit_logs (engine, url, status_code, response) VALUES (?, ?, ?, ?)'
  ).bind(engine, url, statusCode, response.slice(0, 500)).run()
}

export async function getIndexNowKey(env: Bindings, tenantId = 1): Promise<string | undefined> {
  // 优先「系统密钥」中的加密配置（含 Cloudflare Secret 兜底），再退回旧版明文 settings。
  const configured = await getSystemSecret(env, 'INDEXNOW_KEY')
  if (configured) return configured
  const setting = await SettingsStore.forTenant(env, tenantId).get('indexnow_key')
  return setting || undefined
}

// IndexNow：一次性通知公开 URL 的新增、更新或删除。Bing 与其他参与该协议的搜索引擎共享通知；百度普通收录单独使用百度官方提交渠道。
export async function submitIndexNow(env: Bindings, urls: string[], siteUrlOverride?: string) {
  const key = await getIndexNowKey(env)
  if (!key) return { ok: false, skipped: true, error: '未配置 IndexNow Key（系统设置中填写，或设置 secret INDEXNOW_KEY）' }
  const site = (siteUrlOverride || env.SITE_URL || '').replace(/\/$/, '')
  if (!site || site === 'https://your-domain.com') return { ok: false, error: '未配置 SITE_URL（请在 Cloudflare 生产环境变量中设置）' }
  const host = new URL(site).host

  const uniqueUrls = Array.from(new Set(urls))
  const applyCooldown = uniqueUrls.length > 1
  const cooldownKey = 'seo:indexnow:last:' + host
  if (applyCooldown) {
    try {
      const recent = await env.CACHE_KV.get(cooldownKey)
      if (recent) {
        return { ok: false, skipped: true, status: 429, error: 'IndexNow 为避免重复批量提交已进入 10 分钟保护期，请稍后再提交' }
      }
    } catch (e) {
      safeWarn('IndexNow cooldown check failed', { error: String(e) })
    }
  }

  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation: `${site}/${key}.txt`, urlList: uniqueUrls.slice(0, MAX_URLS_PER_INVOCATION) }),
    })
    const response = await res.text()
    await log(env, 'indexnow', Array.from(new Set(urls)).slice(0, MAX_URLS_PER_INVOCATION).join(','), res.status, response)
    if (res.ok && applyCooldown) {
      try { await env.CACHE_KV.put(cooldownKey, new Date().toISOString(), { expirationTtl: INDEXNOW_COOLDOWN_SECONDS }) } catch {}
    }
    return { ok: res.ok, status: res.status, error: res.ok ? undefined : response.slice(0, 300) }
  } catch (e: any) {
    await log(env, 'indexnow', urls.join(','), 0, String(e))
    return { ok: false, error: String(e) }
  }
}

// Bing 自动 URL 通知统一走 IndexNow，不依赖旧 URL Submission API.
export async function submitBing(env: Bindings, urls: string[]) {
  const message = 'Bing：当前模板使用 IndexNow 自动通知；不调用旧 URL Submission API。'
  await log(env, 'bing', urls.join(','), 0, message)
  return { ok: false, skipped: true, status: 0, error: message }
}

// 百度普通收录推送：优先读「系统密钥」里的 BAIDU_TOKEN，兼容旧版明文 settings.baidu_token
export async function submitBaidu(env: Bindings, urls: string[], siteUrlOverride?: string) {
  const token = (await getSystemSecret(env, 'BAIDU_TOKEN')) || await getSetting(env, 'baidu_token')
  if (!token) return { ok: false, error: '尚未配置百度推送 Token，请到「后台 → 系统设置 → 系统密钥 → 搜索引擎推送」填写。' }
  const siteUrl = (siteUrlOverride || env.SITE_URL || '').replace(/\/$/, '')
  if (!siteUrl || siteUrl === 'https://your-domain.com') return { ok: false, error: '未配置 SITE_URL' }
  const host = new URL(siteUrl).host
  try {
    const res = await fetch(`http://data.zz.baidu.com/urls?site=${host}&token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: urls.join('\n'),
    })
    await log(env, 'baidu', urls.join(','), res.status, await res.text())
    return { ok: res.ok, status: res.status }
  } catch (e: any) {
    await log(env, 'baidu', urls.join(','), 0, String(e))
    return { ok: false, error: String(e) }
  }
}

// 360 搜索：主动推送 URL 到 360 站长平台，加快新内容收录。
// 接口：http://data.zz.so.com/urls?site={host}&token={token}，Body 为换行分隔的 URL 列表。
export async function submit360(env: Bindings, urls: string[], siteUrlOverride?: string) {
  const token = (await getSystemSecret(env, 'SO_TOKEN')) || await getSetting(env, 'so_token')
  if (!token) return { ok: false, error: '尚未配置 360 推送 Token，请到「后台 → 系统设置 → 系统密钥 → 搜索引擎推送」填写 SO_TOKEN。' }
  const siteUrl = (siteUrlOverride || env.SITE_URL || '').replace(/\/$/, '')
  if (!siteUrl || siteUrl === 'https://your-domain.com') return { ok: false, error: '未配置 SITE_URL' }
  const host = new URL(siteUrl).host
  try {
    const res = await fetch(`http://data.zz.so.com/urls?site=${host}&token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: urls.join('\n'),
    })
    await log(env, '360', urls.join(','), res.status, await res.text())
    return { ok: res.ok, status: res.status }
  } catch (e: any) {
    await log(env, '360', urls.join(','), 0, String(e))
    return { ok: false, error: String(e) }
  }
}

// 搜狗搜索：主动推送 URL 到搜狗站长平台，加快新内容收录。
// 接口：http://index.sohu.com/api/index?site={host}&token={token}，Body 为换行分隔的 URL 列表。
export async function submitSogou(env: Bindings, urls: string[], siteUrlOverride?: string) {
  const token = (await getSystemSecret(env, 'SOGOU_TOKEN')) || await getSetting(env, 'sogou_token')
  if (!token) return { ok: false, error: '尚未配置搜狗推送 Token，请到「后台 → 系统设置 → 系统密钥 → 搜索引擎推送」填写 SOGOU_TOKEN。' }
  const siteUrl = (siteUrlOverride || env.SITE_URL || '').replace(/\/$/, '')
  if (!siteUrl || siteUrl === 'https://your-domain.com') return { ok: false, error: '未配置 SITE_URL' }
  const host = new URL(siteUrl).host
  try {
    const res = await fetch(`http://index.sohu.com/api/index?site=${host}&token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: urls.join('\n'),
    })
    await log(env, 'sogou', urls.join(','), res.status, await res.text())
    return { ok: res.ok, status: res.status }
  } catch (e: any) {
    await log(env, 'sogou', urls.join(','), 0, String(e))
    return { ok: false, error: String(e) }
  }
}

const MAX_URLS_PER_INVOCATION = 50
const INDEXNOW_COOLDOWN_SECONDS = 600

type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void
}

// Google Indexing API（可选，密钥在「后台 → 系统设置 → 系统密钥 → 搜索引擎推送」填写）
export async function submitGoogle(env: Bindings, urls: string[]) {
  const serviceAccount = await getSystemSecret(env, 'GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!serviceAccount) return { ok: false, error: '尚未配置 Google 索引服务账号，请到「后台 → 系统设置 → 系统密钥 → 搜索引擎推送」粘贴服务账号 JSON。' }
  const result = await submitGoogleIndexing(serviceAccount, urls)
  await log(env, 'google', urls.join(','), result.ok ? 200 : 0, JSON.stringify(result))
  return result
}

// Google / Bing 的 sitemap ping 端点：免密钥、免申请，直接通知搜索引擎重新抓取 sitemap
// 一键推送到所有已配置的搜索引擎渠道
export async function submitAllEngines(env: Bindings, urls: string[], siteUrlOverride?: string) {
  if (!urls.length) return { skipped: true }
  const selected = Array.from(new Set(urls)).slice(0, MAX_URLS_PER_INVOCATION)
  // 发布后 Sitemap 是实时动态源；通知顺序固定为：百度 → IndexNow → Bing备用 → 360 → 搜狗。
  const baidu = await submitBaidu(env, selected, siteUrlOverride)
  const indexnow = await submitIndexNow(env, selected, siteUrlOverride)
  const indexNowKey = await getIndexNowKey(env)
  const bing = indexNowKey
    ? { ok: false, skipped: true, reason: '已使用 IndexNow，跳过重复的 Bing URL Submission API' }
    : await submitBing(env, selected)
  const so = await submit360(env, selected, siteUrlOverride)
  const sogou = await submitSogou(env, selected, siteUrlOverride)
  return {
    indexnow, bing, baidu, so, sogou,
    google: { ok: false, skipped: true, reason: '普通行业页面使用 Sitemap + Google Search Console；Indexing API 仅适用于官方允许的特定页面类型' },
    sitemapPing: { ok: false, skipped: true, reason: '不调用已废弃的 Google/Bing Sitemap Ping 端点；Sitemap 本身实时更新' },
    submittedCount: selected.length,
    skippedCount: Math.max(0, Array.from(new Set(urls)).length - selected.length),
  }
}

export function notifyPublishedUrl(
  env: Bindings,
  url: string,
  siteUrl: string,
  executionContext: WaitUntilContext,
) {
  executionContext.waitUntil(
    submitAllEngines(env, [url], siteUrl).catch((e) => {
      safeError('published URL SEO push failed', undefined, { url, error: String(e) })
    })
  )
}

export function notifyDeletedUrl(
  env: Bindings,
  url: string,
  siteUrl: string,
  executionContext: WaitUntilContext,
) {
  executionContext.waitUntil(
    submitIndexNow(env, [url], siteUrl).catch((e) => {
      safeError('deleted URL IndexNow notification failed', undefined, { url, error: String(e) })
    })
  )
}
