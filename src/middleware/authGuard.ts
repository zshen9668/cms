import { safeError } from '../utils/safeLogger'
import type { MiddlewareHandler } from 'hono'
import type { Bindings, Variables } from '../types'
import { getCookieFromString, getJwtSecret, verifyToken } from '../utils/auth'

async function passwordFingerprint(passwordHash: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passwordHash))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 内置角色：拥有后台全部权限，且不依赖 roles 表（首次部署时 roles 可能还没建）。 */
const BUILTIN_ADMIN_ROLE = 'admin'

/**
 * 判断当前管理员的角色是否允许进入后台。
 *
 * - 内置 'admin'：直接放行。
 * - 自定义角色：必须在本租户的 roles 表中存在，否则视为无效角色（例如角色被删掉后
 *   账号还挂着旧角色名），拒绝登录而不是放行——避免删角色变成提权后门。
 * - roles 表不存在（未跑迁移）时只放行内置 admin，保证后台不会整体打不开。
 */
async function isAdminRoleAllowed(
  c: { env: Bindings; get: (key: string) => any },
  role: string,
): Promise<boolean> {
  const name = String(role || '').trim()
  if (!name) return false
  if (name === BUILTIN_ADMIN_ROLE) return true
  try {
    const tenantId = Number(c.get('tenant')?.id ?? 1) || 1
    const row = await c.env.DB.prepare(
      'SELECT id FROM roles WHERE tenant_id = ? AND name = ?',
    ).bind(tenantId, name).first()
    return !!row
  } catch (e) {
    safeError('admin role lookup failed; falling back to builtin admin only', e)
    return false
  }
}

export const requireAdmin: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const token = getCookieFromString(c.req.header('cookie'), 'admin_session')
  try {
    const secret = await getJwtSecret(c.env)
    const payload = await verifyToken(token, secret)
    const uid = Number((payload as Record<string, unknown>)?.['uid'] || 0)
    if (!payload || !uid) return c.redirect('/admin/login')

    // 会话不仅验证 JWT 签名，还必须对应当前仍存在的管理员账号。
    // pwd 指纹绑定当前密码：修改密码/恢复账号后，旧 JWT 会立即失效，而无需新增 D1 migration。
    const user = await c.env.DB.prepare(
      'SELECT id, email, role, password_hash FROM admin_users WHERE id=?'
    ).bind(uid).first() as any
    if (!user) return c.redirect('/admin/login')
    // 角色校验：内置 'admin' 直接放行；自定义角色必须在本租户的 roles 表里存在。
    //
    // 旧实现写死 `user.role !== 'admin'` 就拒绝，导致「角色管理」里一旦把自定义角色
    // 分配给某个管理员，该账号立刻被锁在后台之外——连重新登录都进不去（无限跳登录页），
    // 只能改数据库才能救回来。自定义角色是「受限管理员」，不是「非管理员」。
    if (!(await isAdminRoleAllowed(c, String(user.role || '')))) return c.redirect('/admin/login')
    if (String((payload as Record<string, unknown>)?.['email'] || '').trim().toLowerCase() !== String(user.email || '').trim().toLowerCase()) {
      return c.redirect('/admin/login')
    }
    const currentFingerprint = await passwordFingerprint(String(user.password_hash || ''))
    if (String((payload as Record<string, unknown>)?.['pwd'] || '') !== currentFingerprint) return c.redirect('/admin/login')

    // 注入当前管理员 uid 与角色到上下文：uid 供插件（versioning / rbac）读取操作者身份，
    // 角色供后台的角色模块权限中间件复用，省掉一次重复的 admin_users 查询。
    c.set('adminUid', uid)
    c.set('adminRole', String(user.role || ''))
    await next()
  } catch (e) {
    safeError('admin auth initialization failed', e)
    return c.text('后台登录密钥未初始化，请检查 CACHE_KV 绑定或设置 JWT_SECRET', 503)
  }
}
