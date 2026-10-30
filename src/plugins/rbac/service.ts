import type { Bindings } from '../../types'
import { SettingsStore } from '../../utils/settingsStore'

export type RoleRow = {
  id: number
  name: string
  tenant_id: number
  created_at: string
  [key: string]: unknown
}

/** 内置基础角色:authGuard 依赖它放行管理端,禁止覆盖/删除 */
export const BUILTIN_ROLE = 'admin'

/** deleteRole 可能返回的错误码 */
export type RoleServiceError =
  | { code: 'not_found' }
  | { code: 'in_use' }

/** 校验角色名:非空、≤40 字符;返回去除首尾空格后的名字 */
export function validateRoleName(raw: unknown): string | null {
  const name = String(raw ?? '').trim()
  if (!name) return null
  if (name.length > 40) return null
  if (name === BUILTIN_ROLE) return null // 内置 'admin' 不作为自定义角色创建
  return name
}

/** 规范化租户 id，无效时回退默认租户 1 */
function normTenantId(tenantId: unknown): number {
  const t = Number(tenantId)
  return Number.isFinite(t) && t > 0 ? t : 1
}

/** 创建角色(每租户名唯一)。返回新角色 id;重名/非法时返回 null */
export async function createRole(env: Bindings, tenantId: unknown, rawName: unknown): Promise<number | null> {
  const t = normTenantId(tenantId)
  const name = validateRoleName(rawName)
  if (!name) return null
  const exists = (await env.DB.prepare(
    'SELECT id FROM roles WHERE tenant_id = ? AND name = ?',
  ).bind(t, name).first()) as any
  if (exists) return null
  const created = (await env.DB.prepare(
    'INSERT INTO roles (tenant_id, name) VALUES (?, ?) RETURNING id',
  ).bind(t, name).first()) as any
  return created?.id ? Number(created.id) : null
}

/** 列出当前租户全部角色 */
export async function listRoles(env: Bindings, tenantId: unknown): Promise<RoleRow[]> {
  const t = normTenantId(tenantId)
  const { results } = await env.DB.prepare(
    'SELECT id, name, tenant_id, created_at FROM roles WHERE tenant_id = ? ORDER BY id',
  ).bind(t).all()
  return (results || []) as unknown as RoleRow[]
}

/** 按 id 取角色名;不存在/跨租户时返回 null */
export async function getRoleName(env: Bindings, tenantId: unknown, roleId: number): Promise<string | null> {
  const t = normTenantId(tenantId)
  const row = (await env.DB.prepare(
    'SELECT name FROM roles WHERE tenant_id = ? AND id = ?',
  ).bind(t, roleId).first()) as any
  return row ? normalizeRoleName(row.name) : null
}

function normalizeRoleName(raw: unknown): string {
  return String(raw ?? '').trim()
}

/** 读取管理员当前角色;账号不存在时返回 null。
 * admin_users.role 是全局列(无 tenant_id),此处不按租户过滤。 */
export async function getAdminRole(env: Bindings, adminId: number): Promise<string | null> {
  const row = (await env.DB.prepare(
    'SELECT role FROM admin_users WHERE id = ?',
  ).bind(adminId).first()) as any
  return row ? normalizeRoleName(row.role) : null
}

/**
 * 判断某管理员是否在指定租户内拥有指定角色(供 hasRole 等 helper 使用)。
 * 规则:
 * 1. 管理员必须拥有一个角色;
 * 2. 管理员的全局角色必须与请求角色匹配,或为内置 'admin' (隐含所有自定义角色);
 * 3. 请求的角色必须在当前租户的 roles 表中已定义,才能在该租户下行使。
 * 这样避免一个租户的管理员凭全局角色在另一个租户下越权。
 */
export async function adminHasRole(env: Bindings, tenantId: unknown, adminId: number, roleName: string): Promise<boolean> {
  const t = normTenantId(tenantId)
  const role = await getAdminRole(env, adminId)
  if (!role) return false
  if (role !== roleName && role !== BUILTIN_ROLE) return false
  // 角色必须在当前租户的 roles 表中存在,才能在该租户下行使该权限
  const exists = (await env.DB.prepare(
    'SELECT id FROM roles WHERE tenant_id = ? AND name = ?',
  ).bind(t, roleName).first()) as any
  return !!exists
}

/**
 * 把角色分配给管理员:UPDATE admin_users SET role=? WHERE id=?。
 * 目标角色必须在当前租户的 roles 表中存在;内置 'admin' 不可作为分配目标。
 * 返回 false 表示账号不存在或角色无效。
 */
export async function assignRole(env: Bindings, tenantId: unknown, adminId: number, roleName: string): Promise<boolean> {
  const t = normTenantId(tenantId)
  const role = normalizeRoleName(roleName)
  if (!role || role === BUILTIN_ROLE) return false
  // 目标角色必须在当前租户的 roles 表中存在
  const roleExists = (await env.DB.prepare(
    'SELECT id FROM roles WHERE tenant_id = ? AND name = ?',
  ).bind(t, role).first()) as any
  if (!roleExists) return false
  const user = (await env.DB.prepare(
    'SELECT id FROM admin_users WHERE id = ?',
  ).bind(adminId).first()) as any
  if (!user) return false
  await env.DB.prepare(
    "UPDATE admin_users SET role = ? WHERE id = ?",
  ).bind(role, adminId).run()
  return true
}

/** 撤销角色:把 admin_users.role 复位为内置 'admin'。返回 false 表示账号不存在 */
export async function revokeRole(env: Bindings, tenantId: unknown, adminId: number): Promise<boolean> {
  const user = (await env.DB.prepare(
    'SELECT id FROM admin_users WHERE id = ?',
  ).bind(adminId).first()) as any
  if (!user) return false
  await env.DB.prepare(
    "UPDATE admin_users SET role = ? WHERE id = ?",
  ).bind(BUILTIN_ROLE, adminId).run()
  return true
}

/** 统计某角色当前被分配给多少个管理员。
 * admin_users.role 是全局列(无 tenant_id),此处统计全局范围;
 * tenantId 参数保留以保持 API 一致性。 */
export async function countRoleAssignments(env: Bindings, tenantId: unknown, roleName: string): Promise<number> {
  const row = (await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM admin_users WHERE role = ?',
  ).bind(normalizeRoleName(roleName)).first()) as any
  return Number(row?.n || 0)
}

/**
 * 删除角色:仅当没有任何管理员仍在使用该角色时允许。
 * 内置 'admin' 角色不可删除。返回错误码或 null(成功)。
 */
export async function deleteRole(
  env: Bindings,
  tenantId: unknown,
  roleId: number,
): Promise<RoleServiceError | null> {
  const t = normTenantId(tenantId)
  const role = (await env.DB.prepare(
    'SELECT id, name FROM roles WHERE tenant_id = ? AND id = ?',
  ).bind(t, roleId).first()) as any
  if (!role) return { code: 'not_found' }
  if (normalizeRoleName(role.name) === BUILTIN_ROLE) return { code: 'in_use' }
  const n = await countRoleAssignments(env, t, role.name)
  if (n > 0) return { code: 'in_use' }
  await env.DB.prepare(
    'DELETE FROM roles WHERE tenant_id = ? AND id = ?',
  ).bind(t, roleId).run()
  return null
}

// ---------------------------------------------------------------------------
// 角色可访问的后台模块
// ---------------------------------------------------------------------------
//
// 权限表存在 settings 表的 role_permissions_json 里（按租户隔离），而不是给 roles 表
// 加列：D1 迁移必须可重复执行，SQLite 的 ALTER TABLE ADD COLUMN 不幂等，加列会让
// `npm run check:schema` 的幂等重放失败。settings 表已有 (key, tenant_id) 复合主键，
// 天然满足「按租户存一份角色→模块映射」的需求。

/** 可授权的后台模块，与后台导航分组 id 一一对应。 */
export const RBAC_MODULES = ['overview', 'content', 'pages', 'seo', 'ai', 'system'] as const
export type RbacModule = (typeof RBAC_MODULES)[number]

export const RBAC_MODULE_LABELS: Record<RbacModule, string> = {
  overview: '总览（数据概览、访问统计）',
  content: '内容（文章、案例、采集、分发、留言）',
  pages: '页面（前台页面、城市、服务、导航联系）',
  seo: 'SEO 增长（推送、GEO、关键词、排名）',
  ai: 'AI（通道、提示词、智能问答）',
  system: '系统（媒体、表单、权限、密钥、设置、自检）',
}

const ROLE_PERMISSIONS_KEY = 'role_permissions_json'

export type RolePermissionMap = Record<string, RbacModule[]>

function normalizeModules(value: unknown): RbacModule[] {
  const list = Array.isArray(value) ? value : []
  const picked = list.map((v) => String(v)).filter((v): v is RbacModule => (RBAC_MODULES as readonly string[]).includes(v))
  return Array.from(new Set(picked))
}

/** 读取当前租户的角色→模块映射。 */
export async function getRolePermissionMap(env: Bindings, tenantId: unknown): Promise<RolePermissionMap> {
  const t = normTenantId(tenantId)
  try {
    const raw = await SettingsStore.forTenant(env, t).get(ROLE_PERMISSIONS_KEY, '')
    const parsed = raw ? JSON.parse(String(raw)) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: RolePermissionMap = {}
    for (const [name, modules] of Object.entries(parsed as Record<string, unknown>)) {
      const key = normalizeRoleName(name)
      if (key) out[key] = normalizeModules(modules)
    }
    return out
  } catch {
    return {}
  }
}

/** 写入某个角色的可访问模块。传空数组表示「该角色不能进任何模块」。 */
export async function setRolePermissions(env: Bindings, tenantId: unknown, roleName: string, modules: unknown): Promise<void> {
  const t = normTenantId(tenantId)
  const name = normalizeRoleName(roleName)
  if (!name) return
  const map = await getRolePermissionMap(env, t)
  map[name] = normalizeModules(modules)
  await SettingsStore.forTenant(env, t).set(ROLE_PERMISSIONS_KEY, JSON.stringify(map))
}

/** 删除角色时同步清掉它的权限配置，避免角色名被复用时继承旧权限。 */
export async function removeRolePermissions(env: Bindings, tenantId: unknown, roleName: string): Promise<void> {
  const t = normTenantId(tenantId)
  const name = normalizeRoleName(roleName)
  if (!name) return
  const map = await getRolePermissionMap(env, t)
  if (!(name in map)) return
  delete map[name]
  await SettingsStore.forTenant(env, t).set(ROLE_PERMISSIONS_KEY, JSON.stringify(map))
}

/**
 * 某角色可访问的模块。
 * 返回 null 表示「未配置 = 不限制」，保证升级前已存在的自定义角色行为不变。
 */
export async function getRoleModules(env: Bindings, tenantId: unknown, roleName: string): Promise<RbacModule[] | null> {
  const name = normalizeRoleName(roleName)
  if (!name) return []
  const map = await getRolePermissionMap(env, tenantId)
  if (!(name in map)) return null
  return map[name] ?? []
}

// ---------------------------------------------------------------------------
// 后台账号
// ---------------------------------------------------------------------------

export type AdminAccountRow = { id: number; email: string; role: string; created_at: string }

/** 列出全部后台账号（admin_users 是全局表，无 tenant_id）。 */
export async function listAdminAccounts(env: Bindings): Promise<AdminAccountRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, email, role, created_at FROM admin_users ORDER BY id',
  ).all()
  return ((results || []) as any[]).map((row) => ({
    id: Number(row.id || 0),
    email: String(row.email || ''),
    role: String(row.role || ''),
    created_at: String(row.created_at || ''),
  }))
}

export type CreateAdminResult = { ok: true; id: number } | { ok: false; error: string }

/**
 * 新建后台账号。
 * 角色必须是内置 'admin' 或当前租户 roles 表里已存在的自定义角色——
 * 否则会造出一个「角色不存在」的账号，登录时被 authGuard 直接拒绝，站长完全不知道为什么进不去。
 */
export async function createAdminAccount(
  env: Bindings,
  tenantId: unknown,
  input: { email: string; passwordHash: string; role: string },
): Promise<CreateAdminResult> {
  const t = normTenantId(tenantId)
  const email = String(input.email || '').trim().toLowerCase()
  const role = normalizeRoleName(input.role) || BUILTIN_ROLE
  if (!email) return { ok: false, error: '邮箱不能为空' }
  if (!input.passwordHash) return { ok: false, error: '密码不能为空' }
  if (role !== BUILTIN_ROLE) {
    const exists = (await env.DB.prepare(
      'SELECT id FROM roles WHERE tenant_id = ? AND name = ?',
    ).bind(t, role).first()) as any
    if (!exists) return { ok: false, error: '角色不存在，请先创建角色' }
  }
  const dup = (await env.DB.prepare('SELECT id FROM admin_users WHERE email = ?').bind(email).first()) as any
  if (dup) return { ok: false, error: '该邮箱已存在' }
  const created = (await env.DB.prepare(
    'INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, ?) RETURNING id',
  ).bind(email, input.passwordHash, role).first()) as any
  const id = Number(created?.id || 0)
  if (!id) return { ok: false, error: '创建失败' }
  return { ok: true, id }
}

/** 删除后台账号。禁止删除最后一个账号，否则后台会彻底进不去。 */
export async function deleteAdminAccount(env: Bindings, adminId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_users').first()) as any
  if (Number(total?.n || 0) <= 1) return { ok: false, error: '至少保留一个后台账号' }
  const row = (await env.DB.prepare('SELECT id FROM admin_users WHERE id = ?').bind(adminId).first()) as any
  if (!row) return { ok: false, error: '账号不存在' }
  await env.DB.prepare('DELETE FROM admin_users WHERE id = ?').bind(adminId).run()
  return { ok: true }
}
