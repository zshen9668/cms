import { Hono } from 'hono'
import type { Context } from 'hono'
import type { CmsPlugin } from '../types'
import type { Bindings, Variables } from '../../types'
import { safeError } from '../../utils/safeLogger'
import { getCookie, getJwtSecret, verifyToken } from '../../utils/auth'
import { getTenantId } from '../../db/scoped'
import {
  createRole, listRoles, getRoleName, deleteRole,
  assignRole, revokeRole, adminHasRole, BUILTIN_ROLE,
  getRolePermissionMap, setRolePermissions, removeRolePermissions,
  listAdminAccounts, createAdminAccount, deleteAdminAccount,
} from './service'
import { renderRolePanel } from '../../templates/adminRbac'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { hashPassword, getPbkdf2Iterations, validatePasswordStrength } from '../../utils/password'

/**
 * 轻量 RBAC 插件(移植 SonicJS rbac-plugin:自定义角色 + 分配/撤销到 admin_users.role)。
 * - 管理端路由挂在 /admin/rbac(requireAdmin 全局拦截已在 admin.ts 生效)
 * - 多租户:角色按租户隔离,操作前按当前请求租户(getTenantId(c))过滤;
 *   admin_users.role 为全局列,保持不变,但分配的角色必须在当前租户的 roles 表中存在
 * - 助手 hasRole(c, roleName):从当前管理员的 JWT uid 读 admin_users.role,并在当前租户校验
 * - 内置 'admin' 角色保留,不可覆盖/删除;删除角色前需无管理员仍在使用
 */
const routes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// 从当前管理员请求的 JWT 取 uid(与 authGuard 同一套签名/验证逻辑)
async function currentAdminId(c: { req?: { raw?: Request } | Request; env: Bindings }): Promise<number | null> {
  const maybeReq = c.req as unknown as { raw?: Request } | Request | undefined
  const req = maybeReq && 'raw' in maybeReq ? (maybeReq as { raw?: Request }).raw : (maybeReq as Request | undefined)
  if (!req) return null
  const token = getCookie(req, 'admin_session')
  const secret = await getJwtSecret(c.env)
  const payload = await verifyToken(token, secret)
  const uid = Number((payload as Record<string, unknown>)?.['uid'] || 0)
  return uid || null
}

async function readAdminId(c: Context<{ Bindings: Bindings; Variables: Variables }>): Promise<number | null> {
  const body = (await c.req.parseBody()) as Record<string, string | File>
  const id = Number(String(body.adminId || '').trim())
  return Number.isInteger(id) && id >= 1 ? id : null
}

routes.get('/rbac', async (c) => {
  try {
    const tenantId = getTenantId(c)
    const roles = await listRoles(c.env, tenantId)
    // 管理员列表：面板要能直接选人分配角色，而不是让站长去猜「管理员 id」。
    // admin_users 是全局表（无 tenant_id），这里列出全部账号。
    let admins: Array<{ id: number; email: string; role: string }> = []
    try {
      admins = await listAdminAccounts(c.env)
    } catch (e) {
      safeError('rbac admin list failed', e)
    }
    // 当前登录人不能删除自己（见面板里的按钮禁用），把 uid 传进去。
    const selfId = c.get('adminUid') ?? 0
    const siteName = await resolveAdminSiteName(c.env, tenantId)
    const cspNonce = (c as any).get('cspNonce') || ''
    const csrfToken = (c as any).get('csrfToken') || ''
    return c.html(renderRolePanel(roles, admins, {
      ok: String(c.req.query('ok') || ''),
      error: String(c.req.query('error') || ''),
    }, await getRolePermissionMap(c.env, tenantId), selfId, siteName, cspNonce, csrfToken))
  } catch (e) {
    safeError('rbac list failed', e)
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('角色列表加载失败'))
  }
})

routes.post('/rbac/roles', async (c) => {
  try {
    const body = (await c.req.parseBody()) as Record<string, string | File>
    const name = String(body.name || '').trim()
    const tenantId = getTenantId(c)
    const id = await createRole(c.env, tenantId, name)
    if (id == null) {
      return c.redirect('/admin/rbac?error=' + encodeURIComponent('角色名无效(非空、≤40 字、不可重名、不可为 admin)'))
    }
    return c.redirect('/admin/rbac?ok=' + encodeURIComponent('角色已创建: ' + name))
  } catch (e) {
    safeError('rbac create role failed', e)
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('角色创建失败'))
  }
})

/**
 * 新建后台账号。
 * 没有这个入口时，系统只有一个管理员账号，自定义角色永远显示「未分配」——
 * 角色管理等于摆设。密码规则与「系统设置 → 管理员账号」保持一致。
 */
routes.post('/rbac/admins', async (c) => {
  try {
    const body = (await c.req.parseBody()) as Record<string, string | File>
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const role = String(body.role || '').trim() || BUILTIN_ROLE
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.redirect('/admin/rbac?error=' + encodeURIComponent('邮箱格式不正确'))
    }
    const passwordError = validatePasswordStrength(password, email)
    if (passwordError) return c.redirect('/admin/rbac?error=' + encodeURIComponent(passwordError))
    const passwordHash = await hashPassword(password, getPbkdf2Iterations(c.env))
    const result = await createAdminAccount(c.env, getTenantId(c), { email, passwordHash, role })
    if (!result.ok) return c.redirect('/admin/rbac?error=' + encodeURIComponent(result.error))
    return c.redirect('/admin/rbac?ok=' + encodeURIComponent('账号已创建：' + email + '（角色 ' + role + '）'))
  } catch (e) {
    safeError('rbac create admin failed', e)
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('账号创建失败'))
  }
})

routes.post('/rbac/admins/:id/delete', async (c) => {
  const adminId = Number(c.req.param('id'))
  if (!Number.isInteger(adminId) || adminId < 1) {
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('无效的管理员 id'))
  }
  if (adminId === Number(c.get('adminUid') ?? 0)) {
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('不能删除当前登录的账号'))
  }
  try {
    const result = await deleteAdminAccount(c.env, adminId)
    if (!result.ok) return c.redirect('/admin/rbac?error=' + encodeURIComponent(result.error))
    return c.redirect('/admin/rbac?ok=' + encodeURIComponent('账号已删除'))
  } catch (e) {
    safeError('rbac delete admin failed', e)
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('账号删除失败'))
  }
})

/**
 * 保存角色的可访问模块。
 * 一个都不勾 = 该角色不能进任何模块（明确拒绝），而不是「不限制」——
 * 否则站长取消全部勾选会得到与预期相反的结果。
 */
routes.post('/rbac/roles/:id/permissions', async (c) => {
  const roleId = Number(c.req.param('id'))
  if (!Number.isInteger(roleId) || roleId < 1) {
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('无效的角色 id'))
  }
  try {
    const tenantId = getTenantId(c)
    const roleName = await getRoleName(c.env, tenantId, roleId)
    if (!roleName) return c.redirect('/admin/rbac?error=' + encodeURIComponent('角色不存在'))
    const body = (await c.req.parseBody({ all: true })) as Record<string, string | string[] | File | File[]>
    const raw = body.modules
    const modules = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((v) => String(v))
    await setRolePermissions(c.env, tenantId, roleName, modules)
    return c.redirect('/admin/rbac?ok=' + encodeURIComponent('已保存「' + roleName + '」的可访问模块'))
  } catch (e) {
    safeError('rbac save role permissions failed', e)
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('权限保存失败'))
  }
})

/**
 * 按管理员改角色（面板主入口）。
 * 选「超级管理员」= 收回自定义角色；选自定义角色 = 分配。
 * 旧面板要求站长手填「管理员 id」再点分配/撤销，站长根本不知道 id 是多少，
 * 等于不可用；这里改成从管理员列表直接选人。
 */
routes.post('/rbac/admins/:id/role', async (c) => {
  const adminId = Number(c.req.param('id'))
  if (!Number.isInteger(adminId) || adminId < 1) {
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('无效的管理员 id'))
  }
  try {
    const body = (await c.req.parseBody()) as Record<string, string | File>
    const role = String(body.role || '').trim()
    const tenantId = getTenantId(c)
    if (!role) return c.redirect('/admin/rbac?error=' + encodeURIComponent('请选择角色'))
    if (role === BUILTIN_ROLE) {
      const ok = await revokeRole(c.env, tenantId, adminId)
      if (!ok) return c.redirect('/admin/rbac?error=' + encodeURIComponent('保存失败：管理员不存在'))
      return c.redirect('/admin/rbac?ok=' + encodeURIComponent('已把管理员 #' + adminId + ' 改回超级管理员'))
    }
    const ok = await assignRole(c.env, tenantId, adminId, role)
    if (!ok) return c.redirect('/admin/rbac?error=' + encodeURIComponent('保存失败：角色不存在或管理员不存在'))
    return c.redirect('/admin/rbac?ok=' + encodeURIComponent('已把管理员 #' + adminId + ' 的角色改为 ' + role))
  } catch (e) {
    safeError('rbac set admin role failed', e)
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('角色保存失败'))
  }
})

routes.post('/rbac/roles/:id/assign', async (c) => {
  const roleId = Number(c.req.param('id'))
  if (!Number.isInteger(roleId) || roleId < 1) {
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('无效的角色 id'))
  }
  try {
    const adminId = await readAdminId(c)
    if (adminId == null) {
      return c.redirect('/admin/rbac?error=' + encodeURIComponent('请提供有效的管理员 id(adminId)'))
    }
    const tenantId = getTenantId(c)
    // 先按 id 解析角色名,再交给 service 做目标合法性校验(拒绝内置 'admin')
    const roleName = await getRoleName(c.env, tenantId, roleId)
    if (!roleName) {
      return c.redirect('/admin/rbac?error=' + encodeURIComponent('角色不存在'))
    }
    const ok = await assignRole(c.env, tenantId, adminId, roleName)
    if (!ok) {
      return c.redirect('/admin/rbac?error=' + encodeURIComponent('分配失败(管理员不存在或角色无效)'))
    }
    return c.redirect('/admin/rbac?ok=' + encodeURIComponent('已分配角色给管理员 #' + adminId))
  } catch (e) {
    safeError('rbac assign role failed', e)
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('角色分配失败'))
  }
})

routes.post('/rbac/roles/:id/revoke', async (c) => {
  const roleId = Number(c.req.param('id'))
  if (!Number.isInteger(roleId) || roleId < 1) {
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('无效的角色 id'))
  }
  try {
    const adminId = await readAdminId(c)
    if (adminId == null) {
      return c.redirect('/admin/rbac?error=' + encodeURIComponent('请提供有效的管理员 id(adminId)'))
    }
    const tenantId = getTenantId(c)
    const ok = await revokeRole(c.env, tenantId, adminId)
    if (!ok) {
      return c.redirect('/admin/rbac?error=' + encodeURIComponent('撤销失败(管理员不存在)'))
    }
    return c.redirect('/admin/rbac?ok=' + encodeURIComponent('已撤销管理员 #' + adminId + ' 的角色'))
  } catch (e) {
    safeError('rbac revoke role failed', e)
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('角色撤销失败'))
  }
})

routes.post('/rbac/roles/:id/delete', async (c) => {
  const roleId = Number(c.req.param('id'))
  if (!Number.isInteger(roleId) || roleId < 1) {
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('无效的角色 id'))
  }
  try {
    const tenantId = getTenantId(c)
    const roleName = await getRoleName(c.env, tenantId, roleId)
    const err = await deleteRole(c.env, tenantId, roleId)
    if (err?.code === 'in_use') {
      return c.redirect('/admin/rbac?error=' + encodeURIComponent('删除失败:仍有管理员在使用该角色,请先撤销'))
    }
    if (err?.code === 'not_found') {
      return c.redirect('/admin/rbac?error=' + encodeURIComponent('角色不存在'))
    }
    // 角色删掉后同步清掉它的模块权限，避免以后建同名角色时继承旧权限。
    if (roleName) await removeRolePermissions(c.env, tenantId, roleName)
    return c.redirect('/admin/rbac?ok=' + encodeURIComponent('角色已删除'))
  } catch (e) {
    safeError('rbac delete role failed', e)
    return c.redirect('/admin/rbac?error=' + encodeURIComponent('角色删除失败'))
  }
})

export const rbacPlugin: CmsPlugin = {
  id: 'rbac',
  version: '1.0.0',
  mount(app) {
    // 挂在 /admin 命名空间下;admin.ts 已对 requireAdmin 全局拦截
    app.route('/admin', routes)
  },
}

/**
 * 助手:判断当前管理员(由 JWT uid 定位)是否在当前租户拥有指定角色。
 * 内置 'admin' 角色隐含所有自定义角色;未登录/JWT 无效时返回 false。
 * c 需形如 Hono Context(req.raw + env),或由 {req:{raw:Request}, env} 构造。
 */
export async function hasRole(c: { req: { raw: Request }; env: Bindings; get: (key: string) => any }, roleName: string): Promise<boolean> {
  const adminId = await currentAdminId(c)
  if (adminId == null) return false
  const tenantId = c.get('tenant')?.id ?? 1
  return adminHasRole(c.env, tenantId, adminId, roleName)
}
