import { safeError } from '../utils/safeLogger'
import type { MiddlewareHandler } from 'hono'
import type { Bindings, Variables } from '../types'
import { getRoleModules } from '../plugins/rbac/service'
import { getTenantId } from '../db/scoped'
import { resolveNavContext, renderNoPermissionPage } from '../templates/adminLayout'

/**
 * 角色模块权限中间件（与 admin.ts 共享）。
 *
 * 「角色权限」面板里勾选的模块在这里真正生效：受限角色访问未勾选的模块会被拦下。
 * - 内置 admin：直接放行。
 * - 未配置权限的角色：放行（兼容升级前已存在的角色）。
 * - 路径解析不出分组：放行，交给下游 404。
 *
 * 依赖 requireAdmin 已把 adminUid / adminRole 注入上下文，因此必须在 requireAdmin 之后挂载。
 */
export function requireRbac(): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c, next) => {
    const uid = Number(c.get('adminUid') || 0)
    if (!uid) return next()
    const nav = resolveNavContext(c.req.path)
    try {
      const role = String(c.get('adminRole') || '').trim()
      if (!role || role === 'admin') return next()
      const allowed = await getRoleModules(c.env, getTenantId(c), role)
      if (allowed === null) return next()
      if (!nav.groupId || allowed.includes(nav.groupId)) return next()
      return c.html(renderNoPermissionPage(nav.group), 403)
    } catch (e) {
      safeError('admin role permission check failed; denying request', e)
      return c.html(renderNoPermissionPage(nav.group), 403)
    }
  }
}
