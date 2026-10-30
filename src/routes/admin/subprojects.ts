import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { safeError } from '../../utils/safeLogger'
import { purgeCacheAll } from '../../middleware/cache'
import { SUBPROJECT_SECTIONS, normalizeSubprojectLayout, normalizeSubprojectSlug, parseSubprojectItems } from '../../utils/subprojects'
import { renderSubprojectForm } from '../../templates/admin'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { errorMessage } from '../../utils/errors'
import { getTenantId } from '../../db/scoped'

export const adminSubprojectsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

adminSubprojectsRoutes.get('/subprojects', async (c) => {
  // 子项目列表已并入「页面管理」统一展示（/admin/pages）。
  // 这里保留 302 而不是直接删路由：老书签、后台旧链接、外部文档里的地址都还能用。
  return c.redirect('/admin/pages', 302)
})

adminSubprojectsRoutes.get('/subprojects/new', async (c) => c.html(renderSubprojectForm({ siteName: await resolveAdminSiteName(c.env, getTenantId(c)), cspNonce: (c as any).get('cspNonce') || '', csrfToken: (c as any).get('csrfToken') || '' })))

adminSubprojectsRoutes.post('/subprojects/new', async (c) => {
  const tenantId = getTenantId(c)
  const b = await c.req.parseBody({ all: true })
  const section = String(b.section || '').trim()
  const meta = SUBPROJECT_SECTIONS.find((item) => item.key === section)
  const name = String(b.name || '').trim().slice(0, 120)
  const labelZh = String(b.label_zh || '').trim().slice(0, 120)
  const labelEn = String(b.label_en || '').trim().slice(0, 120)
  const slug = normalizeSubprojectSlug(b.slug)
  if (!meta || !name || !labelZh || !slug) return c.html(renderSubprojectForm({ error: '栏目、名称、中文标签和 URL Slug 都必须填写。' }), 400)
  const duplicate = await c.env.DB.prepare('SELECT id FROM subprojects WHERE section=? AND tenant_id=? AND (slug=? OR name=?) LIMIT 1').bind(section, tenantId, slug, name).first()
  if (duplicate) return c.html(renderSubprojectForm({ error: '同一栏目下已有相同名称或 Slug，请修改后再保存。' }), 409)
  try {
    const inserted = await c.env.DB.prepare("INSERT INTO subprojects (section,name,slug,label_zh,label_en,title_zh,title_en,subtitle_zh,subtitle_en,content_zh,content_en,seo_title_zh,seo_title_en,seo_description_zh,seo_description_en,seo_keywords_zh,seo_keywords_en,layout,is_active,sort_order,tenant_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(section, name, slug, labelZh, labelEn, String(b.title_zh || '').trim().slice(0, 180), String(b.title_en || '').trim().slice(0, 180), String(b.subtitle_zh || '').trim().slice(0, 300), String(b.subtitle_en || '').trim().slice(0, 300), String(b.content_zh || '').trim().slice(0, 16000), String(b.content_en || '').trim().slice(0, 16000), String(b.seo_title_zh || '').trim().slice(0, 180), String(b.seo_title_en || '').trim().slice(0, 180), String(b.seo_description_zh || '').trim().slice(0, 320), String(b.seo_description_en || '').trim().slice(0, 320), String(b.seo_keywords_zh || '').trim().slice(0, 300), String(b.seo_keywords_en || '').trim().slice(0, 300), normalizeSubprojectLayout(b.layout), b.is_active ? 1 : 0, Number(b.sort_order || 0) || 0, tenantId).first() as any
    const id = Number(inserted?.id || 0)
    if (!id) throw new Error('子项目创建失败')
    const itemIds = parseSubprojectItems(b.item_ids)
    if (itemIds.length) await c.env.DB.batch(itemIds.map((itemId, idx) => c.env.DB.prepare('INSERT OR IGNORE INTO subproject_items (subproject_id,item_type,item_id,sort_order) VALUES (?,?,?,?)').bind(id, meta.itemType, itemId, idx)))
  } catch (e) { safeError('create subproject failed', e); return c.html(renderSubprojectForm({ error: errorMessage(e, '子项目创建失败').slice(0, 220) }), 500) }
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/pages?saved=1')
})

adminSubprojectsRoutes.get('/subprojects/:id/edit', async (c) => {
  const id = Number(c.req.param('id'))
  const tenantId = getTenantId(c)
  if (!Number.isInteger(id) || id <= 0) return c.notFound()
  const p = await c.env.DB.prepare('SELECT * FROM subprojects WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!p) return c.notFound()
  const meta = SUBPROJECT_SECTIONS.find((item) => item.key === String(p.section))
  if (!meta) return c.notFound()
  const allowedTables: Record<string, string> = { articles: 'articles', cities: 'cities', services: 'services' }
  const allowedOrders: Record<string, string> = { articles: 'created_at', cities: 'sort_order', services: 'sort_order' }
  const itemType = String(meta.itemType)
  const itemTable = allowedTables[itemType] || 'articles'
  const orderColumn = allowedOrders[itemType] || 'created_at'
  const selectColumn = itemType === 'article' ? 'title AS name' : 'name'
  const items = (await c.env.DB.prepare('SELECT id, ' + selectColumn + ', slug FROM ' + itemTable + ' WHERE tenant_id=? ORDER BY ' + orderColumn + ' DESC LIMIT 200').bind(tenantId).all()).results as any[]
  const selected = (await c.env.DB.prepare('SELECT si.item_id FROM subproject_items si JOIN subprojects s ON s.id=si.subproject_id WHERE si.subproject_id=? AND si.item_type=? AND s.tenant_id=? ORDER BY si.sort_order,si.id').bind(id, meta.itemType, tenantId).all()).results as any[]
  return c.html(renderSubprojectForm({ subproject: p, items, selectedIds: selected.map((x) => Number(x.item_id)), error: String(c.req.query('error') || '').trim(), siteName: await resolveAdminSiteName(c.env, tenantId), cspNonce: (c as any).get('cspNonce') || '', csrfToken: (c as any).get('csrfToken') || '' }))
})

adminSubprojectsRoutes.post('/subprojects/:id/edit', async (c) => {
  const id = Number(c.req.param('id'))
  const tenantId = getTenantId(c)
  if (!Number.isInteger(id) || id <= 0) return c.notFound()
  const existing = await c.env.DB.prepare('SELECT * FROM subprojects WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!existing) return c.notFound()
  const meta = SUBPROJECT_SECTIONS.find((item) => item.key === String(existing.section))
  if (!meta) return c.notFound()
  const b = await c.req.parseBody({ all: true })
  const name = String(b.name || '').trim().slice(0, 120)
  const labelZh = String(b.label_zh || '').trim().slice(0, 120)
  const labelEn = String(b.label_en || '').trim().slice(0, 120)
  const slug = normalizeSubprojectSlug(b.slug)
  if (!name || !labelZh || !slug) return c.redirect('/admin/subprojects/' + id + '/edit?error=' + encodeURIComponent('名称、中文标签和 URL Slug 都必须填写。'))
  const duplicate = await c.env.DB.prepare('SELECT id FROM subprojects WHERE section=? AND tenant_id=? AND id<>? AND (slug=? OR name=?) LIMIT 1').bind(existing.section, tenantId, id, slug, name).first()
  if (duplicate) return c.redirect('/admin/subprojects/' + id + '/edit?error=' + encodeURIComponent('同一栏目下已有相同名称或 Slug。'))
  await c.env.DB.prepare("UPDATE subprojects SET name=?,slug=?,label_zh=?,label_en=?,title_zh=?,title_en=?,subtitle_zh=?,subtitle_en=?,content_zh=?,content_en=?,seo_title_zh=?,seo_title_en=?,seo_description_zh=?,seo_description_en=?,seo_keywords_zh=?,seo_keywords_en=?,layout=?,is_active=?,sort_order=?,updated_at=datetime('now') WHERE id=? AND tenant_id=?").bind(name, slug, labelZh, labelEn, String(b.title_zh || '').trim().slice(0, 180), String(b.title_en || '').trim().slice(0, 180), String(b.subtitle_zh || '').trim().slice(0, 300), String(b.subtitle_en || '').trim().slice(0, 300), String(b.content_zh || '').trim().slice(0, 16000), String(b.content_en || '').trim().slice(0, 16000), String(b.seo_title_zh || '').trim().slice(0, 180), String(b.seo_title_en || '').trim().slice(0, 180), String(b.seo_description_zh || '').trim().slice(0, 320), String(b.seo_description_en || '').trim().slice(0, 320), String(b.seo_keywords_zh || '').trim().slice(0, 300), String(b.seo_keywords_en || '').trim().slice(0, 300), normalizeSubprojectLayout(b.layout), b.is_active ? 1 : 0, Number(b.sort_order || 0) || 0, id, tenantId).run()
  const itemIds = parseSubprojectItems(b.item_ids)
  await c.env.DB.prepare('DELETE FROM subproject_items WHERE subproject_id=?').bind(id).run()
  if (itemIds.length) await c.env.DB.batch(itemIds.map((itemId, idx) => c.env.DB.prepare('INSERT OR IGNORE INTO subproject_items (subproject_id,item_type,item_id,sort_order) VALUES (?,?,?,?)').bind(id, meta.itemType, itemId, idx)))
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/pages?saved=1')
})

adminSubprojectsRoutes.post('/subprojects/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const tenantId = getTenantId(c)
  if (!Number.isInteger(id) || id <= 0) return c.notFound()
  const row = await c.env.DB.prepare('SELECT id FROM subprojects WHERE id=? AND tenant_id=?').bind(id, tenantId).first()
  if (!row) return c.notFound()
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM subproject_items WHERE subproject_id=?').bind(id), c.env.DB.prepare('DELETE FROM subprojects WHERE id=? AND tenant_id=?').bind(id, tenantId)])
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/pages?deleted=1')
})
