import { safeError } from '../utils/safeLogger'
import type { MiddlewareHandler } from 'hono'
import type { Bindings, Variables, TenantContext } from '../types'

/**
 * 租户识别中间件。
 *
 * 路径模式：/t/{slug}/... → 该租户；其余 → 默认租户 id=1。
 * 查 tenants 表确认 slug 存在；不存在则 404。
 * 数据库查询失败时返回 500，绝不回退到默认租户，防止跨租户数据访问。
 *
 * 注入 c.set('tenant', ...)；后续数据查询自动带 WHERE tenant_id = ?（见 db/scoped.ts）。
 */
export function tenantMiddleware(): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c, next) => {
    const slug = extractTenantSlug(c.req.path)
    if (!slug) {
      // 默认租户：非 /t/ 路径（如 /admin/setup），不自动写入 D1，避免首次部署时干扰 setup
      c.set('tenant', { id: 1, slug: 'main', tier: 'free', status: 'active' } as TenantContext)
      await next()
      return
    }
    try {
      const row = await c.env.DB.prepare('SELECT * FROM tenants WHERE slug = ?').bind(slug).first() as any
      if (!row) {
        c.status(404)
        return c.text(`Tenant not found: ${slug}`, 404)
      }
      c.set('tenant', {
        id: Number(row.id || 1),
        slug,
        tier: (row.tier || 'free') as TenantContext['tier'],
        status: (row.status || 'active') as TenantContext['status'],
      } as TenantContext)
      await next()
    } catch (e) {
      safeError('tenant middleware failed', e)
      // 数据库查询失败时不应回退到默认租户，防止跨租户数据访问
      c.status(500)
      return c.text('无法识别租户，请稍后重试', 500)
    }
  }
}

function extractTenantSlug(path: string): string | null {
  const m = path.match(/^\/t\/([a-z0-9][a-z0-9-]*)/)
  return m?.[1] ?? null
}

/** 取当前请求的 tenantId；默认租户 = 1。 */
export function getTenantId(c: { get: (key: string) => TenantContext | undefined }): number {
  return c.get('tenant')?.id ?? 1
}
