import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { readSettingsMap, saveSetting, buildPublicSeoAudit, getContactMethods, getAiRouteStatus, aiEmptyResultMessage, getTenantId, permanentlyDeleteMediaObject } from './shared'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { safeError } from '../../utils/safeLogger'
import { renderPageSettingsPage, renderPagesHub } from '../../templates/admin'
import { CHINA_CITY_CATALOG } from '../../utils/chinaCityCatalog'
import { getContactAdmin } from '../../modules/adminManagers/contactAdmin'
import { getNavigationAdmin } from '../../modules/adminManagers/navigationAdmin'
import { getLanguageAdmin } from '../../modules/adminManagers/languageAdmin'
import { SettingsStore } from '../../utils/settingsStore'
import { getImageStore, saveImageStore } from '../../utils/imageSettings'
import { getAiContentStore } from '../../utils/aiContentStore'
import { generateAiPageContent } from '../../utils/aiPageContent'
import { errorMessage } from '../../utils/errors'
import { purgeCacheAll } from '../../middleware/cache'
import { purgeCacheTags } from '../../middleware/cache'
import { mediaCacheTag } from '../../middleware/cache'
import { uploadPageImage, removeImage } from '../../utils/pageImages'
import { normalizeKeywordCandidates, alignSeoKeywordsToContent } from '../../utils/autoSeo'
import { isManagedPageKey } from '../../utils/pageSettings'
import { getPageContact } from '../../utils/pageContacts'
import { serializePageSettings } from '../../utils/pageSettings'

export const adminPagesRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/** 复选框取值：浏览器提交 'on'；兼容 '1' / 'true' / 'yes'（例如通过脚本或 API 提交时）。 */
function isChecked(value: unknown): boolean {
  return ['on', '1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase())
}

async function loadPageSettingsFromDb(env: Bindings, tenantId: number) {
  const raw = await SettingsStore.forTenant(env, tenantId).get('page_settings_json', '')
  const { getPageSettings } = await import('../../utils/pageSettings')
  return getPageSettings(raw ? { page_settings_json: raw } : {})
}

adminPagesRoutes.get('/pages', async (c) => {
  const tenantId = getTenantId(c)
  const tabParam = String(c.req.query('tab') || 'pages')
  const tab = (['pages', 'cities', 'services', 'modules'] as const).includes(tabParam as any)
    ? tabParam as 'pages' | 'cities' | 'services' | 'modules'
    : 'pages'
  const pages = Object.values(await loadPageSettingsFromDb(c.env, tenantId))
  const audit = await buildPublicSeoAudit(c.env, tenantId)
  const auditByKey = new Map(audit.pages.filter((p) => p.type === 'home' || p.type === 'list').map((p) => [p.key, p.audit]))
  const pageRows = pages.map((page: any) => ({ ...page, seoAudit: auditByKey.get(page.key) || null }))
  // 子项目 / 栏目标签并入本页统一管理：它们本质是「页面」的一种
  // （每个子项目都有自己的前台 URL、标签、SEO），单独占一个导航项会让
  // 站长在两个地方来回找。这里只读列表，增删改仍走 /admin/subprojects/* 表单。
  let subprojects: any[] = []
  try {
    subprojects = (await c.env.DB.prepare(
      'SELECT s.*, COUNT(si.id) AS item_count FROM subprojects s LEFT JOIN subproject_items si ON si.subproject_id=s.id WHERE s.tenant_id=? GROUP BY s.id ORDER BY s.section, s.sort_order, s.id',
    ).bind(tenantId).all()).results as any[]
  } catch (e) {
    safeError('subprojects read failed on pages page', e)
  }
  const message = c.req.query('saved') === '1' ? '子项目已保存。' : c.req.query('deleted') === '1' ? '子项目已删除；关联服务、文章、城市不会被删除。' : ''

  // 城市 / 服务 / 导航联系三个分页签的数据按需加载，避免每次打开页面都多跑三组查询。
  let cities: { rows: any[]; catalog: any[]; message?: string } | undefined
  let services: { rows: any[]; aiKeys: Set<string>; imageStore: any } | undefined
  let modules: { contacts: any[]; navigation: any[]; languages: any[]; message?: string; error?: string } | undefined

  if (tab === 'cities') {
    const rows = (await c.env.DB.prepare('SELECT * FROM cities WHERE tenant_id = ? ORDER BY sort_order, id').bind(tenantId).all()).results as any[]
    const settings = await readSettingsMap(c.env, tenantId)
    const aiRows = (await c.env.DB.prepare("SELECT key FROM settings WHERE key LIKE 'ai_page:cities:%'").all()).results as any[]
    const aiKeys = new Set(aiRows.map((row) => String(row.key).slice('ai_page:cities:'.length)))
    const legacyStore = getAiContentStore(settings)
    for (const row of rows) row.ai_content_exists = aiKeys.has(String(row.slug)) || !!legacyStore.cities[String(row.slug)]?.content
    rows.sort((a, b) => Number(Boolean(a.ai_content_exists)) - Number(Boolean(b.ai_content_exists)) || Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id || 0) - Number(b.id || 0))
    const bulkError = String(c.req.query('bulk_error') || '').trim().slice(0, 220)
    const aiError = String(c.req.query('ai_error') || '').trim().slice(0, 220)
    cities = {
      rows,
      catalog: CHINA_CITY_CATALOG,
      message: c.req.query('duplicate') === '1' ? '该城市已在城市库中，系统已自动去重。'
        : c.req.query('bulk_deleted') ? `已批量删除 ${Math.max(0, Number(c.req.query('bulk_deleted')) || 0)} 个城市；已生成和待生成内容、启用和停用城市均按同一规则清理。`
        : c.req.query('ai_generated') === '1' ? 'AI城市内容已生成并保存，继续留在城市列表即可查看“已生成”状态。'
        : bulkError ? '批量删除失败：' + bulkError
        : aiError ? 'AI城市内容生成失败：' + aiError : '',
    }
  }

  if (tab === 'services') {
    const rows = (await c.env.DB.prepare('SELECT * FROM services WHERE tenant_id=? ORDER BY sort_order').bind(tenantId).all()).results as any[]
    const settings = await readSettingsMap(c.env, tenantId)
    const aiRows = (await c.env.DB.prepare("SELECT key FROM settings WHERE key LIKE 'ai_page:services:%'").all()).results as any[]
    services = {
      rows,
      aiKeys: new Set(aiRows.map((row) => String(row.key).slice('ai_page:services:'.length))),
      imageStore: getImageStore(settings),
    }
  }

  if (tab === 'modules') {
    const [contacts, navigation, languages] = await Promise.all([
      getContactAdmin(c.env),
      getNavigationAdmin(c.env),
      getLanguageAdmin(c.env),
    ])
    modules = {
      contacts, navigation, languages,
      message: String(c.req.query('ok') || '').trim(),
      error: String(c.req.query('error') || '').trim(),
    }
  }

  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  return c.html(renderPagesHub({
    tab,
    pages: pageRows,
    subprojects,
    message,
    cities,
    services,
    modules,
    siteName,
    cspNonce,
  }))
})

adminPagesRoutes.get('/pages/:key/edit', async (c) => {
  const key = c.req.param('key')
  if (!isManagedPageKey(key)) return c.notFound()
  const pages = await loadPageSettingsFromDb(c.env, getTenantId(c))
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const images = getImageStore(settings)
  const pageContact = getPageContact(settings, key, getContactMethods(settings))
  const audit = await buildPublicSeoAudit(c.env, getTenantId(c))
  const currentAudit = audit.pages.find((p) => (p.type === 'home' || p.type === 'list') && p.key === key)?.audit || null
  const currentPage = { ...pages[key], seoAudit: currentAudit }
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const cspNonce = (c as any).get("csrfToken") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  return c.html(renderPageSettingsPage(Object.values(pages), currentPage, c.req.query('error') || '', images.home, [], c.req.query('message') || '', siteName, cspNonce, csrfToken))
})

adminPagesRoutes.post('/pages/:key/edit', async (c) => {
  const key = c.req.param('key')
  if (!isManagedPageKey(key)) return c.notFound()
  const pages = await loadPageSettingsFromDb(c.env, getTenantId(c))
  const b = await c.req.parseBody()
  const mode = b.mode === 'external' ? 'external' : b.mode === 'hidden' ? 'hidden' : 'internal'
  const externalUrl = String(b.external_url || '').trim()
  if (mode === 'external' && !isHttpUrl(externalUrl)) return c.html(renderPageSettingsPage(Object.values(pages), pages[key], '外站链接必须填写有效的 http:// 或 https:// 地址'))
  const clean = (v: unknown, max: number) => String(v || '').trim().slice(0, max)
  pages[key] = { ...pages[key], mode, labelZh: clean(b.label_zh, 60) || pages[key].labelZh, labelEn: clean(b.label_en, 60) || pages[key].labelEn, externalUrl: mode === 'external' ? externalUrl : '', titleZh: clean(b.title_zh, 200), titleEn: clean(b.title_en, 200), subtitleZh: clean(b.subtitle_zh, 500), subtitleEn: clean(b.subtitle_en, 500), contentZh: clean(b.content_zh, 12000), contentEn: clean(b.content_en, 12000), seoKeywordsZh: clean(b.seo_keywords_zh, 300), seoKeywordsEn: clean(b.seo_keywords_en, 300), showForm: isChecked(b.show_form) }
  // 写入必须与读取（loadPageSettingsFromDb → forTenant）同一个租户：
  // SettingsStore.for() 不带租户，set() 会无条件写 tenant_id = 1，
  // 一旦后台按租户提供服务，保存的标题/副标题/正文会落到别的租户行上——表单回显为空、前台永远读不到。
  await saveSetting(c.env, 'page_settings_json', serializePageSettings(pages), getTenantId(c))
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/pages/' + key + '/edit')
})

adminPagesRoutes.post('/pages/:key/ai-content', async (c) => {
  const key = c.req.param('key')
  if (!isManagedPageKey(key)) return c.notFound()
  const pages = await loadPageSettingsFromDb(c.env, getTenantId(c))
  const page = pages[key]
  if (page.mode !== 'internal') return c.redirect('/admin/pages/' + key + '/edit?error=' + encodeURIComponent('外站链接或隐藏页面不需要生成本站 AI 内容'))
  try {
    const ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'page', pageLabel: page.label, pagePath: page.path, title: page.titleZh, summary: page.subtitleZh, sourceContent: page.contentZh })
    if (!ai) { const status = await getAiRouteStatus(c.env); const message = status.ok ? aiEmptyResultMessage('AI页面生成', status.settings) : status.message; return c.redirect('/admin/pages/' + key + '/edit?error=' + encodeURIComponent(message)) }
    page.titleZh = ai.title; page.subtitleZh = ai.summary; page.contentZh = ai.content
    page.seoKeywordsZh = alignSeoKeywordsToContent([page.labelZh, page.labelZh + '服务', page.labelZh + '办理', page.labelZh + '流程', ...normalizeKeywordCandidates((await readSettingsMap(c.env, getTenantId(c))).site_keywords || '', 15)], ai.title, ai.summary, ai.content, 5).join(',')
    page.aiGenerated = true
    await saveSetting(c.env, 'page_settings_json', serializePageSettings(pages), getTenantId(c))
    if (key === 'home') await saveSetting(c.env, 'site_seo_ai_generated', '1', getTenantId(c))
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    return c.redirect('/admin/pages/' + key + '/edit?ai=1')
  } catch (e) { safeError('AI managed page generation failed', e); return c.redirect('/admin/pages/' + key + '/edit?error=' + encodeURIComponent(errorMessage(e, 'AI页面生成失败'))) }
})

adminPagesRoutes.post('/pages/:key/clear', async (c) => {
  const key = c.req.param('key')
  if (!isManagedPageKey(key)) return c.notFound()
  const pages = await loadPageSettingsFromDb(c.env, getTenantId(c))
  pages[key] = { ...pages[key], mode: 'internal', externalUrl: '', titleZh: '', titleEn: '', subtitleZh: '', subtitleEn: '', contentZh: '', contentEn: '', seoKeywordsZh: '', seoKeywordsEn: '', aiGenerated: false, showForm: true }
  await saveSetting(c.env, 'page_settings_json', serializePageSettings(pages), getTenantId(c))
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const imageStore = getImageStore(settings)
  if (key === 'home' && imageStore.home) { const old = imageStore.home; delete imageStore.home; await saveImageStoreSetting(c.env, imageStore); await deletePageImage(c.env, old) }
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/pages/' + key + '/edit')
})

async function saveImageStoreSetting(env: Bindings, store: ReturnType<typeof getImageStore>) {
  await saveSetting(env, 'image_settings_json', saveImageStore(store))
}

async function deletePageImage(c: any, oldImage: any): Promise<void> { if (!oldImage?.key) return; await permanentlyDeleteMediaObject(c, oldImage.key) }

// ---- R2 页面图片管理 ----
adminPagesRoutes.post('/page-images/home', async (c) => {
  const length = Number(c.req.header('content-length') || 0)
  if (length && length > 5 * 1024 * 1024 + 256 * 1024) return c.redirect('/admin/pages/home/edit?error=' + encodeURIComponent('图片请求过大，单文件最大 5MB'))
  const body = await c.req.parseBody()
  const file = body.file instanceof File ? body.file : null
  if (!file || !file.name) return c.redirect('/admin/pages/home/edit?error=' + encodeURIComponent('请选择图片'))
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const store = getImageStore(settings)
  try {
    const next = await uploadPageImage(c.env, 'home', 'home', file)
    const old = store.home
    store.home = next
    await saveImageStoreSetting(c.env, store)
    await deletePageImage(c, old)
    if (old?.key) c.executionCtx.waitUntil(purgeCacheTags(c.executionCtx, [mediaCacheTag(old.key)]))
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    return c.redirect('/admin/pages/home/edit')
  } catch (e) {
    return c.redirect('/admin/pages/home/edit?error=' + encodeURIComponent(errorMessage(e)))
  }
})

adminPagesRoutes.post('/page-images/home/delete', async (c) => {
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const store = getImageStore(settings)
  const old = removeImage(store, 'home')
  await saveImageStoreSetting(c.env, store)
  await deletePageImage(c, old)
  if (old?.key) c.executionCtx.waitUntil(purgeCacheTags(c.executionCtx, [mediaCacheTag(old.key)]))
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/pages/home/edit')
})

for (const group of ['city', 'service'] as const) {
  adminPagesRoutes.post('/page-images/' + group + '/:slug', async (c) => {
    const slug = String(c.req.param('slug') || '').trim()
    const editPath = group === 'city' ? '/admin/cities' : '/admin/services'
    if (!slug) return c.redirect(editPath + '?error=' + encodeURIComponent('缺少页面标识'))
    const length = Number(c.req.header('content-length') || 0)
    if (length && length > 5 * 1024 * 1024 + 256 * 1024) return c.redirect(editPath + '?error=' + encodeURIComponent('图片请求过大，单文件最大 5MB'))
    const body = await c.req.parseBody()
    const file = body.file instanceof File ? body.file : null
    if (!file || !file.name) return c.redirect(editPath + '?error=' + encodeURIComponent('请选择图片'))
    const settings = await readSettingsMap(c.env, getTenantId(c))
    const store = getImageStore(settings)
    try {
      const next = await uploadPageImage(c.env, group, slug, file)
      const bucket = group === 'city' ? store.cities : store.services
      const old = bucket[slug]
      bucket[slug] = next
      await saveImageStoreSetting(c.env, store)
      await deletePageImage(c, old)
      if (old?.key) c.executionCtx.waitUntil(purgeCacheTags(c.executionCtx, [mediaCacheTag(old.key)]))
      c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
      return c.redirect(editPath)
    } catch (e) {
      return c.redirect(editPath + '?error=' + encodeURIComponent(errorMessage(e)))
    }
  })

  adminPagesRoutes.post('/page-images/' + group + '/:slug/delete', async (c) => {
    const slug = c.req.param('slug')
    const settings = await readSettingsMap(c.env, getTenantId(c))
    const store = getImageStore(settings)
    const old = removeImage(store, group === 'city' ? 'cities' : 'services', slug)
    await saveImageStoreSetting(c.env, store)
    await deletePageImage(c, old)
    if (old?.key) c.executionCtx.waitUntil(purgeCacheTags(c.executionCtx, [mediaCacheTag(old.key)]))
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    return c.redirect(group === 'city' ? '/admin/cities' : '/admin/services')
  })
}

function isHttpUrl(url: string): boolean { try { return /^https?:\/\//i.test(url) } catch { return false } }
