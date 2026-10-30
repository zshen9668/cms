import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import type { ImageEntry } from '../../utils/imageSettings'
import { readSettingsMap, saveSetting, getGlobalSeoKeywords, getServiceAiKeywords, getAiRouteStatus, aiEmptyResultMessage, getTenantId } from './shared'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { safeError } from '../../utils/safeLogger'
import { renderServiceForm } from '../../templates/admin'
import { autoServiceSeo } from '../../utils/autoSeo'
import { generateAiPageContent } from '../../utils/aiPageContent'
import { SettingsStore } from '../../utils/settingsStore'
import { getAiContentStore, saveAiContentStore, aiContentSettingKey, getAiContentEntryDb, getAiContentEntry } from '../../utils/aiContentStore'
import { getContactMethods } from '../../utils/contactSettings'
import { getPageContact } from '../../utils/pageContacts'
import { isHttpUrl } from '../../utils/pageSettings'
import { getImageStore, saveImageStore } from '../../utils/imageSettings'
import { deletePageImage } from '../../utils/pageImages'
import { removePageContact, deleteR2PrefixBatch } from '../../utils/resourceCleanup'
import { errorMessage } from '../../utils/errors'
import { purgeCacheAll } from '../../middleware/cache'

export const adminServicesRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function loadServiceExternalLinks(env: Bindings, tenantId: number): Promise<Record<string, string>> {
  const store = SettingsStore.forTenant(env, tenantId)
  const raw = await store.get('service_external_links', '')
  const { getServiceExternalLinks } = await import('../../utils/serviceSettings')
  return getServiceExternalLinks(raw ? { service_external_links: raw } : {})
}

async function removeImageFromStore(store: any, group: string, slug: string): Promise<ImageEntry | undefined> {
  const bucket = store[group]
  if (!bucket || !bucket[slug]) return undefined
  const old = bucket[slug]
  delete bucket[slug]
  return old as ImageEntry | undefined
}

async function saveImageStoreSetting(env: Bindings, store: ReturnType<typeof getImageStore>) {
  await saveSetting(env, 'image_settings_json', saveImageStore(store))
}

adminServicesRoutes.get('/services/new', async (c) => {
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  const globalSeoKeywords = settings.site_keywords || ''
  return c.html(renderServiceForm({ name: '', slug: '', summary: '', demand_weight: 50, is_active: 1, sort_order: 0 }, '', '', undefined, globalSeoKeywords, siteName, cspNonce, csrfToken))
})

adminServicesRoutes.post('/services/new', async (c) => {
  const tenantId = getTenantId(c)
  const b = await c.req.parseBody()
  const name = String(b.name || '').trim().slice(0, 100)
  const slug = String(b.slug || '').trim().toLowerCase().slice(0, 120)
  const summary = String(b.summary || '').trim().slice(0, 500)
  const demandWeight = Math.max(0, Math.min(100, parseInt(String(b.demand_weight || '50'), 10) || 50))
  const isActive = b.is_active ? 1 : 0
  if (!name) return c.text('请填写服务名称', 400)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return c.text('URL slug 只能使用小写字母、数字和短横线，例如 dai-li-ji-zhang', 406)
  }
  const exists = await c.env.DB.prepare('SELECT id FROM services WHERE tenant_id = ? AND (name=? OR slug=?) LIMIT 1').bind(tenantId, name, slug).first()
  if (exists) return c.text('服务名称或 URL slug 已存在，请换一个', 409)
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const globalSeoKeywords = settings.site_keywords || ''
  const seo = isActive ? autoServiceSeo({ name, summary }, c.env.SITE_NAME || '网站内容平台', globalSeoKeywords) : { seo_title: '', seo_description: '', seo_keywords: '' }
  try {
    const created = await c.env.DB.prepare('INSERT INTO services (name, slug, summary, tenant_id, is_active, sort_order, seo_title, seo_description, seo_keywords, demand_weight) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order)+1 FROM services WHERE tenant_id = ?), 0), ?, ?, ?, ?)').bind(name, slug, summary, tenantId, isActive, tenantId, seo.seo_title, seo.seo_description, seo.seo_keywords, demandWeight).run()
    const id = Number(created.meta?.last_row_id || 0)
    if (!id) return c.text('服务创建失败，请稍后重试', 500)
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    return c.redirect('/admin/services/' + id + '/edit?created=1')
  } catch (e) {
    safeError('create service failed', e)
    return c.text(errorMessage(e, '服务创建失败'), 500)
  }
})

adminServicesRoutes.get('/services/:id/edit', async (c) => {
  const service = await c.env.DB.prepare('SELECT * FROM services WHERE id=? AND tenant_id=?').bind(c.req.param('id'), getTenantId(c)).first() as any
  if (!service) return c.notFound()
  const links = await loadServiceExternalLinks(c.env, getTenantId(c))
  service.external_url = links[service.slug] || ''
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const images = getImageStore(settings)
  const aiContent = await getAiContentEntryDb(c.env, getTenantId(c), settings, 'services', service.slug)
  const globalSeoKeywords = settings.site_keywords || ''
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  const pageContact = getPageContact(settings, 'service:' + service.slug, getContactMethods(settings))
  return c.html(renderServiceForm(service, aiContent?.content || '', '', images.services[service.slug], globalSeoKeywords, siteName, cspNonce, csrfToken))
})

adminServicesRoutes.post('/services/:id/edit', async (c) => {
  const id = c.req.param('id')
  const tenantId = getTenantId(c)
  const b = await c.req.parseBody()
  const active = b.is_active ? 1 : 0
  const current = await c.env.DB.prepare('SELECT * FROM services WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!current) return c.notFound()
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const globalSeoKeywords = settings.site_keywords || ''
  const generated = active ? autoServiceSeo({ name: current.name, summary: current.summary }, c.env.SITE_NAME || '网站内容平台', globalSeoKeywords) : null
  const seoTitle = generated?.seo_title || ''
  const seoDescription = generated?.seo_description || ''
  const seoKeywords = generated?.seo_keywords || ''
  const externalUrl = String(b.external_url || '').trim()
  if (externalUrl && !isHttpUrl(externalUrl)) return c.text('服务外站链接必须是有效的 http:// 或 https:// 地址', 400)
  await c.env.DB.prepare('UPDATE services SET demand_weight=?, is_active=?, seo_title=?, seo_description=?, seo_keywords=? WHERE id=? AND tenant_id=?').bind(parseInt(String(b.demand_weight || '50'), 10), active, seoTitle, seoDescription, seoKeywords, id, tenantId).run()
  const links = await loadServiceExternalLinks(c.env, tenantId)
  if (externalUrl) links[current.slug] = externalUrl
  else delete links[current.slug]
  await saveSetting(c.env, 'service_external_links', JSON.stringify(links), getTenantId(c))
  const existingContent = getAiContentEntry(settings, 'services', current.slug)
  const pageContent = String(b.page_content || '').trim().slice(0, 16000)
  if (pageContent) await saveSetting(c.env, aiContentSettingKey('services', current.slug), JSON.stringify({ ...(existingContent || {}), title: current.name, summary: current.summary || '', content: pageContent, updatedAt: new Date().toISOString() }), getTenantId(c))
  else if (active && !existingContent?.content) {
    const serviceKeywords = await getServiceAiKeywords(c.env, getTenantId(c), Number(current.id), String(current.name), globalSeoKeywords)
    const ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'service', service: current.name, keywords: serviceKeywords })
    if (ai) await saveSetting(c.env, aiContentSettingKey('services', current.slug), JSON.stringify({ ...ai, updatedAt: new Date().toISOString() }), getTenantId(c))
  }
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/services')
})

adminServicesRoutes.post('/services/:id/auto-seo', async (c) => {
  const id = c.req.param('id')
  const tenantId = getTenantId(c)
  const service = await c.env.DB.prepare('SELECT * FROM services WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!service) return c.notFound()
  const seo = autoServiceSeo({ name: service.name, summary: service.summary }, c.env.SITE_NAME || '网站内容平台', await getGlobalSeoKeywords(c.env, getTenantId(c)))
  await c.env.DB.prepare('UPDATE services SET seo_title=?, seo_description=?, seo_keywords=? WHERE id=? AND tenant_id=?').bind(seo.seo_title, seo.seo_description, seo.seo_keywords, id, tenantId).run()
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/services/' + id + '/edit')
})

adminServicesRoutes.post('/services/:id/delete', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  const tenantId = getTenantId(c)
  const service = await c.env.DB.prepare('SELECT slug FROM services WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!service) return c.notFound()
  const slug = String(service.slug || '').trim()
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const imageStore = getImageStore(settings)
  const oldImage = await removeImageFromStore(imageStore, 'services', slug)
  const aiStore = getAiContentStore(settings)
  delete aiStore.services[slug]
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM keywords WHERE service_id=? AND tenant_id=?').bind(id, tenantId), c.env.DB.prepare('DELETE FROM services WHERE id=? AND tenant_id=?').bind(id, tenantId), c.env.DB.prepare('DELETE FROM settings WHERE key=?').bind(aiContentSettingKey('services', slug))])
  await removePageContact(c.env, ['service:' + slug])
  await saveSetting(c.env, 'ai_page_content_json', saveAiContentStore(aiStore), getTenantId(c))
  const links = await loadServiceExternalLinks(c.env, tenantId)
  delete links[slug]
  await saveSetting(c.env, 'service_external_links', JSON.stringify(links), getTenantId(c))
  await saveImageStoreSetting(c.env, imageStore)
  await deletePageImage(c.env, oldImage)
  let cursor = ''
  for (let page = 0; page < 10; page++) {
    const batch = await deleteR2PrefixBatch(c.env, 'media/pages/service/' + slug + '/', cursor, 25)
    if (batch.complete) break
    cursor = batch.nextCursor
    if (!cursor) break
  }
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/services')
})

adminServicesRoutes.post('/services/:id/ai-content', async (c) => {
  const id = c.req.param('id')
  const tenantId = getTenantId(c)
  const service = await c.env.DB.prepare('SELECT * FROM services WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!service) return c.notFound()
  const keywords = await getServiceAiKeywords(c.env, getTenantId(c), Number(service.id), String(service.name), await getGlobalSeoKeywords(c.env, getTenantId(c)))
  const ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'service', service: service.name, keywords })
  if (!ai) {
    const status = await getAiRouteStatus(c.env)
    return c.text(status.ok ? aiEmptyResultMessage('AI服务页面生成', status.settings) : status.message, 503)
  }
  await saveSetting(c.env, aiContentSettingKey('services', service.slug), JSON.stringify({ ...ai, updatedAt: new Date().toISOString() }), getTenantId(c))
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/services/' + id + '/edit')
})

adminServicesRoutes.post('/services/:id/content/delete', async (c) => {
  const id = c.req.param('id')
  const tenantId = getTenantId(c)
  const service = await c.env.DB.prepare('SELECT slug FROM services WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!service) return c.notFound()
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const store = getAiContentStore(settings)
  delete store.services[service.slug]
  await c.env.DB.prepare('DELETE FROM settings WHERE key=?').bind(aiContentSettingKey('services', service.slug)).run()
  await saveSetting(c.env, 'ai_page_content_json', saveAiContentStore(store), getTenantId(c))
  const images = getImageStore(settings)
  const oldImage = await removeImageFromStore(images, 'services', service.slug)
  await saveImageStoreSetting(c.env, images)
  await deletePageImage(c.env, oldImage)
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/services/' + id + '/edit')
})

// 服务管理已并入「页面管理」的服务分页签；旧地址保留为跳转。
adminServicesRoutes.get('/services', (c) => {
  const qs = new URL(c.req.url).search
  return c.redirect('/admin/pages?tab=services' + (qs ? '&' + qs.slice(1) : ''))
})
