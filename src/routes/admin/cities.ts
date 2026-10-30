import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { readSettingsMap, saveSetting, getGlobalSeoKeywords, getCityAiKeywords, getTenantId, errorMessage } from './shared'
import { safeError, safeWarn } from '../../utils/safeLogger'
import { autoCitySeo } from '../../utils/autoSeo'
import { generateAiPageContent } from '../../utils/aiPageContent'
import { getAiSettings } from '../../utils/aiSettings'
import { getAiContentStore, saveAiContentStore, aiContentSettingKey, getAiContentEntry } from '../../utils/aiContentStore'
import { deleteR2PrefixBatch, removePageContact } from '../../utils/resourceCleanup'
import { deletePageImage, removeImage } from '../../utils/pageImages'
import { getImageStore, saveImageStore } from '../../utils/imageSettings'
import { purgeCacheAll, purgeCacheTags, mediaCacheTag } from '../../middleware/cache'
import { renderCityForm } from '../../templates/admin'
import { resolveAdminSiteName } from '../../utils/adminSiteName'

export const adminCitiesRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

function mediaSafeKey(raw: unknown): string { const key = String(raw || '').trim(); if (!key || !key.startsWith('media/') || key.includes('..')) return ''; return key }
async function saveImageStoreSetting(env: Bindings, store: ReturnType<typeof getImageStore>) { await saveSetting(env, 'image_settings_json', saveImageStore(store)) }

// 城市管理已并入「页面管理」的城市分页签；旧地址保留为跳转，避免书签/文档里的链接失效。
adminCitiesRoutes.get('/cities', (c) => {
  const qs = new URL(c.req.url).search
  return c.redirect('/admin/pages?tab=cities' + (qs ? '&' + qs.slice(1) : ''))
})

adminCitiesRoutes.post('/cities/add', async (c) => {
  const tenantId = getTenantId(c)
  const b = await c.req.parseBody()
  let province = String(b['province'] || '').trim(), name = String(b['name'] || '').trim(), slug = String(b['slug'] || '').trim().toLowerCase(), tier = String(b['tier'] || '二线')
  if (b['catalog_key']) { const parts = String(b['catalog_key']).split('|'); if (parts.length === 4) { province = parts[0] ?? province; name = parts[1] ?? name; slug = parts[2] ?? slug; tier = parts[3] ?? tier } }
  if (!province || !name || !slug || !/^[a-z0-9-]+$/.test(slug)) return c.text('城市信息不完整或 slug 格式错误', 400)
  const existingCity = await c.env.DB.prepare('SELECT id FROM cities WHERE tenant_id = ? AND (name=? OR slug=?) LIMIT 1').bind(tenantId, name, slug).first()
  if (existingCity) return c.redirect('/admin/cities?duplicate=1')
  try { await c.env.DB.prepare('INSERT INTO cities (name, slug, province, tier, tenant_id, is_active, sort_order) SELECT ?, ?, ?, ?, ?, 1, COALESCE(MAX(sort_order),0)+1 FROM cities WHERE tenant_id = ?').bind(name, slug, province, tier, tenantId, tenantId).run() } catch (e) { safeError('city insert failed', e); return c.redirect('/admin/cities?duplicate=1') }
  const globalSeoKeywords = await getGlobalSeoKeywords(c.env, getTenantId(c))
  const seo = autoCitySeo({ name }, c.env.SITE_NAME || '网站内容平台', globalSeoKeywords)
  await c.env.DB.prepare(`UPDATE cities SET seo_title=?, seo_description=?, seo_keywords=? WHERE slug=? AND (TRIM(COALESCE(seo_title,''))='' OR TRIM(COALESCE(seo_description,''))='' OR TRIM(COALESCE(seo_keywords,''))='')`).bind(seo.seo_title, seo.seo_description, seo.seo_keywords, slug).run()
  const settings = await readSettingsMap(c.env, getTenantId(c))
  c.executionCtx.waitUntil((async () => { if (getAiContentEntry(settings, 'cities', slug)?.content) return; try { const createdCity = await c.env.DB.prepare('SELECT id FROM cities WHERE slug=? AND tenant_id=?').bind(slug, tenantId).first() as any; const keywords = createdCity?.id ? await getCityAiKeywords(c.env, getTenantId(c), Number(createdCity.id), name, globalSeoKeywords) : []; const ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'city', city: name, keywords }); if (ai) await saveSetting(c.env, aiContentSettingKey('cities', slug), JSON.stringify({ ...ai, updatedAt: new Date().toISOString() }), getTenantId(c)) } catch (e) { safeError('new city AI content generation failed', e) } })())
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/cities')
})

adminCitiesRoutes.get('/cities/:id/edit', async (c) => {
  const city = await c.env.DB.prepare('SELECT * FROM cities WHERE id=? AND tenant_id=?').bind(c.req.param('id'), getTenantId(c)).first() as any
  if (!city) return c.notFound()
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const images = getImageStore(settings)
  const aiContent = await c.env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(aiContentSettingKey('cities', city.slug)).first() as any
  let aiContentParsed: any = undefined
  if (aiContent?.value) try { aiContentParsed = JSON.parse(String(aiContent.value)) } catch {}
  const globalSeoKeywords = settings.site_keywords || ''
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  return c.html(renderCityForm(city, aiContentParsed?.content || '', '', images.cities[city.slug], globalSeoKeywords, siteName, cspNonce, csrfToken))
})

adminCitiesRoutes.post('/cities/:id/edit', async (c) => {
  const id = c.req.param('id'), tenantId = getTenantId(c), b = await c.req.parseBody()
  const active = b.is_active ? 1 : 0
  const current = await c.env.DB.prepare('SELECT * FROM cities WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!current) return c.notFound()
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const globalSeoKeywords = settings.site_keywords || ''
  const generated = active ? autoCitySeo({ name: current.name }, c.env.SITE_NAME || '网站内容平台', globalSeoKeywords) : null
  const seoTitle = generated?.seo_title || '', seoDescription = generated?.seo_description || '', seoKeywords = generated?.seo_keywords || ''
  await c.env.DB.prepare('UPDATE cities SET tier=?, is_active=?, seo_title=?, seo_description=?, seo_keywords=? WHERE id=? AND tenant_id=?').bind(b.tier, active, seoTitle, seoDescription, seoKeywords, id, tenantId).run()
  const pageContent = String(b.page_content || '').trim().slice(0, 16000)
  if (pageContent) await saveSetting(c.env, aiContentSettingKey('cities', current.slug), JSON.stringify({ ...current, title: current.name + (settings.site_topic || settings.site_industry || '服务信息'), summary: '本地化服务信息', content: pageContent, updatedAt: new Date().toISOString() }), getTenantId(c))
  else if (active) { const keywords = await getCityAiKeywords(c.env, getTenantId(c), Number(current.id), String(current.name), globalSeoKeywords); const ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'city', city: current.name, keywords }); if (ai) await saveSetting(c.env, aiContentSettingKey('cities', current.slug), JSON.stringify({ ...ai, updatedAt: new Date().toISOString() }), getTenantId(c)) }
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/cities')
})

adminCitiesRoutes.post('/cities/:id/auto-seo', async (c) => {
  const id = c.req.param('id'), tenantId = getTenantId(c)
  const city = await c.env.DB.prepare('SELECT * FROM cities WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!city) return c.notFound()
  const seo = autoCitySeo({ name: city.name }, c.env.SITE_NAME || '网站内容平台', await getGlobalSeoKeywords(c.env, getTenantId(c)))
  await c.env.DB.prepare('UPDATE cities SET seo_title=?, seo_description=?, seo_keywords=? WHERE id=? AND tenant_id=?').bind(seo.seo_title, seo.seo_description, seo.seo_keywords, id, tenantId).run()
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/cities/' + id + '/edit')
})

adminCitiesRoutes.post('/cities/bulk-delete', async (c) => {
  const body = await c.req.parseBody({ all: true }), tenantId = getTenantId(c)
  const rawIds = body.city_ids, values = Array.isArray(rawIds) ? rawIds : rawIds ? [rawIds] : []
  const ids = Array.from(new Set(values.map((v) => Number(String(v))).filter((id) => Number.isInteger(id) && id > 0))).slice(0, 100)
  if (!ids.length) return c.redirect('/admin/cities?bulk_deleted=0')
  const placeholders = ids.map(() => '?').join(',')
  const cityRows = (await c.env.DB.prepare(`SELECT id, slug FROM cities WHERE tenant_id = ? AND id IN (${placeholders})`).bind(tenantId, ...ids).all()).results as any[]
  if (!cityRows.length) return c.redirect('/admin/cities?bulk_deleted=0')
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const aiStore = getAiContentStore(settings)
  const imageStore = getImageStore(settings)
  const slugs: string[] = []
  const pageContactKeys: string[] = []
  const oldImages: any[] = []
  for (const city of cityRows) {
    const slug = String(city.slug || '').trim()
    if (!slug) continue
    slugs.push(slug)
    pageContactKeys.push('city:' + slug)
    const oldImage = removeImage(imageStore, 'cities', slug)
    if (oldImage) oldImages.push(oldImage)
    delete aiStore.cities[slug]
  }
  const statements: any[] = []
  for (const id of cityRows.map((row) => Number(row.id))) {
    statements.push(
      c.env.DB.prepare('UPDATE articles SET city_id=NULL WHERE city_id=? AND tenant_id=? AND COALESCE(ai_generated, 0)=0').bind(id, tenantId),
      c.env.DB.prepare('DELETE FROM social_posts WHERE article_id IN (SELECT id FROM articles WHERE city_id=? AND tenant_id=? AND ai_generated=1)').bind(id, tenantId),
      c.env.DB.prepare('DELETE FROM review_logs WHERE article_id IN (SELECT id FROM articles WHERE city_id=? AND tenant_id=? AND ai_generated=1)').bind(id, tenantId),
      c.env.DB.prepare('DELETE FROM keywords WHERE city_id=? AND tenant_id=?').bind(id, tenantId),
      c.env.DB.prepare('DELETE FROM articles WHERE city_id=? AND tenant_id=? AND ai_generated=1').bind(id, tenantId),
      c.env.DB.prepare('DELETE FROM cities WHERE id=? AND tenant_id=?').bind(id, tenantId),
    )
  }
  for (let offset = 0; offset < slugs.length; offset += 25) {
    const chunk = slugs.slice(offset, offset + 25)
    for (const slug of chunk) {
      statements.push(c.env.DB.prepare('DELETE FROM settings WHERE key=?').bind(aiContentSettingKey('cities', slug)))
    }
  }
  try {
    for (let offset = 0; offset < statements.length; offset += 100) {
      await c.env.DB.batch(statements.slice(offset, offset + 100))
    }
    await removePageContact(c.env, pageContactKeys)
    await saveSetting(c.env, 'ai_page_content_json', saveAiContentStore(aiStore), getTenantId(c))
    await saveImageStoreSetting(c.env, imageStore)
  } catch (e) {
    safeError('bulk city delete failed', e)
    const detail = String((e as any)?.message || '').slice(0, 180)
    return c.redirect('/admin/cities?bulk_error=' + encodeURIComponent(detail || '数据库删除失败，请查看 Worker 日志'))
  }
  c.executionCtx.waitUntil((async () => {
    for (const oldImage of oldImages) {
      try {
        await deletePageImage(c.env, oldImage)
        if (oldImage?.key) await purgeCacheTags(c.executionCtx, [mediaCacheTag(oldImage.key)])
      } catch (e) {
        safeWarn('bulk city image cleanup failed', { error: String(e) })
      }
    }
    for (const slug of slugs) {
      let cursor = ''
      for (let page = 0; page < 10; page++) {
        try {
          const batch = await deleteR2PrefixBatch(c.env, 'media/pages/city/' + slug + '/', cursor, 25)
          if (batch.complete || !batch.nextCursor) break
          cursor = batch.nextCursor
        } catch (e) {
          safeWarn('bulk city R2 prefix cleanup failed', { slug, error: String(e) })
          break
        }
      }
    }
    await purgeCacheAll(c.executionCtx)
  })())
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/cities?bulk_deleted=' + cityRows.length)
})

adminCitiesRoutes.post('/cities/:id/delete', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  const tenantId = getTenantId(c)
  const city = await c.env.DB.prepare('SELECT slug FROM cities WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!city) return c.notFound()
  const slug = String(city.slug || '').trim()
  const settings = await readSettingsMap(c.env, getTenantId(c)), imageStore = getImageStore(settings), oldImage = removeImage(imageStore, 'cities', slug), aiStore = getAiContentStore(settings)
  delete aiStore.cities[slug]
  await c.env.DB.batch([c.env.DB.prepare('UPDATE articles SET city_id=NULL WHERE city_id=? AND tenant_id=? AND COALESCE(ai_generated, 0)=0').bind(id, tenantId), c.env.DB.prepare('DELETE FROM social_posts WHERE article_id IN (SELECT id FROM articles WHERE city_id=? AND tenant_id=? AND ai_generated=1)').bind(id, tenantId), c.env.DB.prepare('DELETE FROM review_logs WHERE article_id IN (SELECT id FROM articles WHERE city_id=? AND tenant_id=? AND ai_generated=1)').bind(id, tenantId), c.env.DB.prepare('DELETE FROM keywords WHERE city_id=? AND tenant_id=?').bind(id, tenantId), c.env.DB.prepare('DELETE FROM articles WHERE city_id=? AND tenant_id=? AND ai_generated=1').bind(id, tenantId), c.env.DB.prepare('DELETE FROM cities WHERE id=? AND tenant_id=?').bind(id, tenantId), c.env.DB.prepare('DELETE FROM settings WHERE key=?').bind(aiContentSettingKey('cities', slug))])
  await removePageContact(c.env, ['city:' + slug])
  await saveSetting(c.env, 'ai_page_content_json', saveAiContentStore(aiStore), getTenantId(c))
  await saveImageStoreSetting(c.env, imageStore)
  await deletePageImage(c.env, oldImage)
  let cursor = ''
  for (let page = 0; page < 10; page++) { const batch = await deleteR2PrefixBatch(c.env, 'media/pages/city/' + slug + '/', cursor, 25); if (batch.complete) break; cursor = batch.nextCursor; if (!cursor) break }
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/cities')
})

adminCitiesRoutes.post('/cities/:id/ai-content', async (c) => {
  const id = c.req.param('id'), tenantId = getTenantId(c)
  const city = await c.env.DB.prepare('SELECT * FROM cities WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!city) return c.notFound()
  const aiSettings = await getAiSettings(c.env)
  if (!aiSettings.enabled) return c.text('AI 功能当前已停用。', 503)
  try { const keywords = await getCityAiKeywords(c.env, getTenantId(c), Number(city.id), String(city.name), await getGlobalSeoKeywords(c.env, getTenantId(c))); const ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'city', city: city.name, keywords }, aiSettings); if (!ai) return c.redirect('/admin/cities?ai_error=' + encodeURIComponent('Workers AI 未返回可保存的城市内容，请检查 AI设置和城市页面提示词。')); await saveSetting(c.env, aiContentSettingKey('cities', city.slug), JSON.stringify({ ...ai, updatedAt: new Date().toISOString() }), getTenantId(c)) } catch (e) { safeError('AI city content generation failed', e); return c.redirect('/admin/cities?ai_error=' + encodeURIComponent(errorMessage(e, 'AI城市内容生成失败').slice(0, 220))) }
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/cities?ai_generated=1')
})

adminCitiesRoutes.post('/cities/:id/content/delete', async (c) => {
  const id = c.req.param('id'), tenantId = getTenantId(c)
  const city = await c.env.DB.prepare('SELECT slug FROM cities WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!city) return c.notFound()
  const settings = await readSettingsMap(c.env, getTenantId(c)), store = getAiContentStore(settings)
  delete store.cities[city.slug]
  await c.env.DB.prepare('DELETE FROM settings WHERE key=?').bind(aiContentSettingKey('cities', city.slug)).run()
  await saveSetting(c.env, 'ai_page_content_json', saveAiContentStore(store), getTenantId(c))
  const images = getImageStore(settings), oldImage = removeImage(images, 'cities', city.slug)
  await saveImageStoreSetting(c.env, images)
  await deletePageImage(c.env, oldImage)
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/cities/' + id + '/edit')
})