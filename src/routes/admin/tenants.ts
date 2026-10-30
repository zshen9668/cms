import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { getTenantId } from './shared'
import { renderTenantsList, renderTenantForm } from '../../templates/adminTenants'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { safeError } from '../../utils/safeLogger'

// 产品定位：单站自用。/admin/tenants 是全局管理面，不做租户隔离——
// 列表/新建/编辑都刻意不带 WHERE tenant_id=?，因为「管理所有租户」正是它的职责。
// 若未来改为 SaaS 多租户售卖，必须先在本文件加 superadmin 门禁（见 #5 方案 B）。
export const adminTenantsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

adminTenantsRoutes.get('/tenants', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get('cspNonce') || ''
  const csrfToken = (c as any).get('csrfToken') || ''
  let rows: Array<{ id: number; slug: string; display_name: string; owner_email: string; tier: string; status: string; created_at: string }> = []
  try {
    const result = await env.DB.prepare(
      'SELECT id, slug, display_name, owner_email, tier, status, created_at FROM tenants ORDER BY id DESC'
    ).all() as any
    rows = (result.results || []).map((r: any) => ({
      id: Number(r.id),
      slug: String(r.slug || ''),
      display_name: String(r.display_name || ''),
      owner_email: String(r.owner_email || ''),
      tier: String(r.tier || ''),
      status: String(r.status || ''),
      created_at: String(r.created_at || ''),
    }))
  } catch (e) {
    safeError('tenants list read failed', e)
  }
  return c.html(renderTenantsList(rows, siteName, cspNonce, csrfToken))
})

adminTenantsRoutes.get('/tenants/new', async (c) => {
  const tenantId = getTenantId(c)
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get('cspNonce') || ''
  const csrfToken = (c as any).get('csrfToken') || ''
  return c.html(renderTenantForm({
    id: undefined, slug: '', display_name: '', owner_email: '', tier: 'free', status: 'active',
  }, { isNew: true }, siteName, cspNonce, csrfToken))
})

adminTenantsRoutes.get('/tenants/:id/edit', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get('cspNonce') || ''
  const csrfToken = (c as any).get('csrfToken') || ''
  const id = Number(c.req.param('id'))
  let tenant: { id: number; slug: string; display_name: string; owner_email: string; tier: string; status: string } | null = null
  try {
    const r = await env.DB.prepare(
      'SELECT id, slug, display_name, owner_email, tier, status FROM tenants WHERE id = ?'
    ).bind(id).first() as any
    if (r) {
      tenant = {
        id: Number(r.id), slug: String(r.slug || ''), display_name: String(r.display_name || ''),
        owner_email: String(r.owner_email || ''), tier: String(r.tier || ''), status: String(r.status || ''),
      }
    }
  } catch (e) {
    safeError('tenant read failed', e)
  }
  if (!tenant) return c.notFound()
  return c.html(renderTenantForm(tenant, { isNew: false }, siteName, cspNonce, csrfToken))
})

adminTenantsRoutes.post('/tenants', async (c) => {
  const env = c.env
  const b = await c.req.parseBody()
  const slug = String(b.slug || '').trim()
  const display_name = String(b.display_name || '').trim()
  const owner_email = String(b.owner_email || '').trim()
  const tier = String(b.tier || 'free')
  const status = String(b.status || 'active')

  if (!slug || !display_name || !owner_email) {
    return c.redirect('/admin/tenants/new?error=' + encodeURIComponent('租户名称、Slug、所有者邮箱必填'))
  }

  try {
    await env.DB.prepare(
      'INSERT INTO tenants (slug, display_name, owner_email, tier, status) VALUES (?, ?, ?, ?, ?)'
    ).bind(slug, display_name, owner_email, tier, status).run()
    return c.redirect('/admin/tenants?message=' + encodeURIComponent('租户已新建'))
  } catch (e: any) {
    safeError('tenant create failed', e)
    return c.redirect('/admin/tenants/new?error=' + encodeURIComponent(String(e?.message || '新建失败')))
  }
})

adminTenantsRoutes.post('/tenants/:id/edit', async (c) => {
  const env = c.env
  const id = Number(c.req.param('id'))
  const b = await c.req.parseBody()
  const slug = String(b.slug || '').trim()
  const display_name = String(b.display_name || '').trim()
  const owner_email = String(b.owner_email || '').trim()
  const tier = String(b.tier || 'free')
  const status = String(b.status || 'active')

  if (!slug || !display_name || !owner_email) {
    return c.redirect('/admin/tenants/' + id + '/edit?error=' + encodeURIComponent('租户名称、Slug、所有者邮箱必填'))
  }

  try {
    await env.DB.prepare(
      'UPDATE tenants SET slug = ?, display_name = ?, owner_email = ?, tier = ?, status = ? WHERE id = ?'
    ).bind(slug, display_name, owner_email, tier, status, id).run()
    return c.redirect('/admin/tenants?message=' + encodeURIComponent('租户已保存'))
  } catch (e: any) {
    safeError('tenant update failed', e)
    return c.redirect('/admin/tenants/' + id + '/edit?error=' + encodeURIComponent(String(e?.message || '保存失败')))
  }
})
