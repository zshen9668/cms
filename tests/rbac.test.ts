import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { signToken } from '../src/utils/auth.ts'
import { rbacPlugin, hasRole } from '../src/plugins/rbac/index.ts'
import { requireAdmin } from '../src/middleware/authGuard.ts'
import {
  createRole, listRoles, getRoleName, deleteRole, countRoleAssignments, adminHasRole,
  assignRole, revokeRole, getAdminRole,
} from '../src/plugins/rbac/service.ts'

const SECRET = 'test-secret-key-at-least-32-chars!!'

/** 最小 D1 shim:按语句中的表名做内存 CRUD,覆盖 rbac 服务用到的语句模式 */
class D1Shim {
  roles: Array<{ id: number; name: string; tenant_id: number; created_at: string }> = []
  admins: Array<{ id: number; email: string; role: string }> = []
  private roleSeq = 0
  private adminSeq = 0

  addRole(name: string, tenantId = 1) {
    this.roles.push({ id: ++this.roleSeq, name, tenant_id: tenantId, created_at: '2026-01-01 00:00:00' })
    return this.roles.at(-1)!.id
  }

  addAdmin(email: string, role = 'admin') {
    this.admins.push({ id: ++this.adminSeq, email, role })
    return this.admins.at(-1)!.id
  }

  prepare(text: string): any {
    const q = { text, binds: [] as any[] }
    const self = this
    const table = /FROM\s+(roles|admin_users)/i.exec(text)?.[1]
    return {
      bind(...vals: any[]) {
        q.binds = vals
        return this
      },
      async all() {
        if (table === 'roles') {
          return {
            results: self.roles.filter((r) => {
              // 角色查询通常形如 WHERE tenant_id = ? [AND name = ?]
              if (q.binds.length === 0) return true
              if (r.tenant_id !== q.binds[0]) return false
              if (q.binds.length >= 2) return r.name === q.binds[1]
              return true
            }),
          }
        }
        return { results: [] }
      },
      async first() {
        // INSERT ... RETURNING id:返回新行(以 id 为键),供 createRole 取 id
        if (/INSERT INTO roles/i.test(q.text)) {
          const row = { id: ++self.roleSeq, name: q.binds[1], tenant_id: q.binds[0], created_at: '2026-01-01 00:00:00' }
          self.roles.push(row)
          return { id: row.id, name: row.name, tenant_id: row.tenant_id }
        }
        if (table === 'roles') {
          if (q.binds.length >= 2) {
            // WHERE tenant_id = ? AND (name = ? OR id = ?)
            const hit = self.roles.find(
              (r) => r.tenant_id === q.binds[0] && (r.name === q.binds[1] || r.id === q.binds[1]),
            )
            if (hit) return hit
            return null
          }
          if (q.binds.length === 1) return self.roles.find((r) => r.id === q.binds[0]) || null
          return null
        }
        if (table === 'admin_users') {
          if (/COUNT\(\*\)/i.test(q.text)) {
            return { n: self.admins.filter((a) => a.role === q.binds[0]).length }
          }
          return self.admins.find((a) => a.id === q.binds[0]) || null
        }
        return null
      },
      async run() {
        if (/INSERT INTO roles/i.test(q.text)) {
          const row = { id: ++self.roleSeq, name: q.binds[1], tenant_id: q.binds[0], created_at: '2026-01-01 00:00:00' }
          self.roles.push(row)
          return { meta: { changes: 1 }, values: [row.id] }
        }
        if (/UPDATE admin_users/i.test(q.text)) {
          const target = self.admins.find((a) => a.id === q.binds[1])
          if (target) target.role = q.binds[0]
          return { meta: { changes: target ? 1 : 0 } }
        }
        if (/DELETE FROM roles/i.test(q.text)) {
          self.roles = self.roles.filter((r) => !(r.tenant_id === q.binds[0] && r.id === q.binds[1]))
          return { meta: { changes: 1 } }
        }
        return { meta: { changes: 0 } }
      },
    }
  }
}

function makeEnv(shim = new D1Shim()) {
  return { DB: shim, JWT_SECRET: SECRET } as any
}

function cookieFor(uid: number) {
  return signToken({ uid, email: 'u' + uid + '@x.com' }, SECRET)
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 构造 requireAdmin 需要的最小 Hono Context 形状。 */
function mockAdminContext(env: any, token: string) {
  const store = new Map<string, any>([['tenant', { id: 1 }]])
  let redirectTo = ''
  return {
    env,
    req: { header: (name: string) => (name.toLowerCase() === 'cookie' ? 'admin_session=' + encodeURIComponent(token) : undefined) },
    get: (key: string) => store.get(key),
    set: (key: string, value: any) => { store.set(key, value) },
    redirect: (to: string) => { redirectTo = to; return new Response(null, { status: 302 }) },
    get redirectTo() { return redirectTo },
  }
}

/**
 * 回归测试：把自定义角色分配给管理员后，该账号必须仍能进入后台。
 *
 * 旧实现里 requireAdmin 写死 `user.role !== 'admin'` 就拒绝，导致在「角色权限」里
 * 一分配自定义角色，账号立刻被锁在后台之外——连重新登录都进不去（无限跳登录页），
 * 只能改数据库救回来。这条测试锁死该行为。
 */
test('requireAdmin 允许自定义角色进入后台（分配角色不再锁死账号）', async () => {
  const shim = new D1Shim()
  shim.addRole('editor', 1)
  const adminId = shim.addAdmin('editor@example.com', 'editor')
  const admin = shim.admins.find((a) => a.id === adminId) as any
  admin.password_hash = 'hash-editor'
  const env = makeEnv(shim)
  const token = await signToken(
    { uid: adminId, email: 'editor@example.com', pwd: await sha256Hex('hash-editor') },
    SECRET,
    3600,
  )
  const c = mockAdminContext(env, token)
  let passed = false
  await requireAdmin(c as any, async () => { passed = true })
  assert.equal(passed, true, '自定义角色必须能进入后台，不能被锁在登录页')
})

test('requireAdmin 拒绝 roles 表里不存在的角色（删角色不能变成提权后门）', async () => {
  const shim = new D1Shim()
  // 故意不建 roles 行：账号挂着一个已不存在的角色名
  const adminId = shim.addAdmin('ghost@example.com', 'ghost-role')
  const admin = shim.admins.find((a) => a.id === adminId) as any
  admin.password_hash = 'hash-ghost'
  const env = makeEnv(shim)
  const token = await signToken(
    { uid: adminId, email: 'ghost@example.com', pwd: await sha256Hex('hash-ghost') },
    SECRET,
    3600,
  )
  const c = mockAdminContext(env, token)
  let passed = false
  await requireAdmin(c as any, async () => { passed = true })
  assert.equal(passed, false, '角色不存在时必须拒绝，而不是放行')
})

test('requireAdmin 始终放行内置 admin 角色（不依赖 roles 表）', async () => {
  const shim = new D1Shim()
  const adminId = shim.addAdmin('root@example.com', 'admin')
  const admin = shim.admins.find((a) => a.id === adminId) as any
  admin.password_hash = 'hash-root'
  const env = makeEnv(shim)
  const token = await signToken(
    { uid: adminId, email: 'root@example.com', pwd: await sha256Hex('hash-root') },
    SECRET,
    3600,
  )
  const c = mockAdminContext(env, token)
  let passed = false
  await requireAdmin(c as any, async () => { passed = true })
  assert.equal(passed, true, '内置 admin 必须放行，即使 roles 表为空')
})

async function mountApp(shim: D1Shim, cookie: string | undefined) {
  const app = new Hono()
  rbacPlugin.mount(app)
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = 'admin_session=' + encodeURIComponent(cookie)
  return { app, shim, headers, env: makeEnv(shim) }
}

test('createRole: name 校验与每租户唯一约束', async () => {
  const env = makeEnv()
  assert.equal(await createRole(env, 1, ''), null)
  assert.equal(await createRole(env, 1, 'admin'), null) // 内置角色不可作为自定义角色
  assert.equal(await createRole(env, 1, 'x'.repeat(41)), null) // 超过 40 字
  const id = await createRole(env, 1, 'editor')
  assert.ok(id)
  assert.equal(await createRole(env, 1, 'editor'), null) // 同租户重名
  assert.equal(await createRole(env, 1, '  editor  '), null) // 去空格后重名
  // 不同租户可使用同一角色名
  assert.ok(await createRole(env, 2, 'editor'))
})

test('listRoles 返回按 id 排序的角色,且按租户隔离', async () => {
  const shim = new D1Shim()
  const env = makeEnv(shim)
  shim.addRole('a', 1)
  shim.addRole('b', 1)
  shim.addRole('c', 2) // 租户 2 的角色不应出现在租户 1 的列表中
  const roles = await listRoles(env, 1)
  assert.deepEqual(roles.map((r) => r.name), ['a', 'b'])
  const roles2 = await listRoles(env, 2)
  assert.deepEqual(roles2.map((r) => r.name), ['c'])
})

test('assignRole / revokeRole 更新 admin_users.role', async () => {
  const shim = new D1Shim()
  const env = makeEnv(shim)
  const roleId = shim.addRole('editor', 1)
  const adminId = shim.addAdmin('a@x.com')
  assert.ok(await assignRole(env, 1, adminId, 'editor'))
  assert.equal(shim.admins[0]!.role, 'editor')
  assert.equal(await assignRole(env, 1, 999, 'editor'), false) // 账号不存在
  assert.equal(await assignRole(env, 1, adminId, 'admin'), false) // 内置角色不可作为分配目标
  assert.equal(await assignRole(env, 2, adminId, 'editor'), false) // 租户 2 未定义 editor 角色
  assert.ok(await revokeRole(env, 1, adminId))
  assert.equal(shim.admins[0]!.role, 'admin')
  assert.equal(await revokeRole(env, 1, 999), false)
  void roleId
})

test('deleteRole: 有分配时 in_use,清空后可删;不存在时 not_found', async () => {
  const shim = new D1Shim()
  const env = makeEnv(shim)
  const roleId = shim.addRole('editor', 1)
  const adminId = shim.addAdmin('a@x.com')
  await assignRole(env, 1, adminId, 'editor')
  assert.deepEqual(await deleteRole(env, 1, roleId), { code: 'in_use' })
  assert.equal(await countRoleAssignments(env, 1, 'editor'), 1)
  await revokeRole(env, 1, adminId)
  assert.deepEqual(await deleteRole(env, 1, 42), { code: 'not_found' })
  assert.equal(await deleteRole(env, 1, roleId), null)
  assert.equal(shim.roles.length, 0)
})

test('adminHasRole: 内置 admin 隐含自定义角色,跨租户不越权', async () => {
  const shim = new D1Shim()
  const env = makeEnv(shim)
  shim.addRole('editor', 1)
  shim.addRole('editor', 2) // 租户 2 也定义 editor
  const builtIn = shim.addAdmin('root@x.com', 'admin')
  const editor1 = shim.addAdmin('ed1@x.com', 'editor')
  const editor2 = shim.addAdmin('ed2@x.com', 'editor')
  // 租户 1 的 editor 管理员在租户 1 行使 editor 权限
  assert.equal(await adminHasRole(env, 1, editor1, 'editor'), true)
  // 租户 1 的 editor 管理员在租户 2 不应行使 editor 权限(若租户 2 未定义 editor)
  shim.roles = shim.roles.filter((r) => !(r.tenant_id === 2 && r.name === 'editor'))
  assert.equal(await adminHasRole(env, 2, editor1, 'editor'), false)
  // 跨租户访问不存在的租户/角色
  assert.equal(await adminHasRole(env, 9, editor1, 'editor'), false)
  assert.equal(await adminHasRole(env, 1, editor2, 'editor2'), false) // editor2 未创建
  assert.equal(await adminHasRole(env, 1, 999, 'editor'), false)
})

test('GET /admin/rbac 返回角色权限 HTML 面板', async () => {
  const shim = new D1Shim()
  shim.addRole('editor', 1)
  const { app, headers, env } = await mountApp(shim, await cookieFor(1))
  const res = await app.request('/admin/rbac', { headers }, env)
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /角色权限/)
  assert.match(html, /editor/)
  // 面板必须给出「这个功能能做什么 / 怎么用」，否则站长建完角色不知道下一步做什么。
  assert.match(html, /这个功能能做什么/)
  assert.match(html, /管理员与角色/)
})

test('POST /admin/rbac/roles 创建角色(合法/非法)', async () => {
  const shim = new D1Shim()
  const { app, headers, env } = await mountApp(shim, await cookieFor(1))

  const ok = await app.request('/admin/rbac/roles', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'name=writer',
  }, env)
  assert.equal(ok.status, 302)
  assert.equal(ok.headers.get('location'), '/admin/rbac?ok=' + encodeURIComponent('角色已创建: writer'))
  assert.deepEqual(shim.roles.map((r) => r.name), ['writer'])

  const bad = await app.request('/admin/rbac/roles', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'name=admin',
  }, env)
  assert.equal(bad.headers.get('location'), '/admin/rbac?error=' + encodeURIComponent('角色名无效(非空、≤40 字、不可重名、不可为 admin)'))
  assert.equal(shim.roles.length, 1)
})

test('POST assign/delete 路由串联 service 行为', async () => {
  const shim = new D1Shim()
  const roleId = shim.addRole('editor', 1)
  const adminId = shim.addAdmin('a@x.com')
  const { app, headers, env } = await mountApp(shim, await cookieFor(1))
  const form = { 'Content-Type': 'application/x-www-form-urlencoded' }

  const assigned = await app.request(`/admin/rbac/roles/${roleId}/assign`, {
    method: 'POST', headers: { ...headers, ...form }, body: 'adminId=' + adminId,
  }, env)
  assert.match(decodeURIComponent(assigned.headers.get('location')!), /已分配角色给管理员 #/)
  assert.equal(shim.admins[0]!.role, 'editor')

  // 仍有分配,删除应被拒
  const blocked = await app.request(`/admin/rbac/roles/${roleId}/delete`, {
    method: 'POST', headers: { ...headers },
  }, env)
  assert.match(decodeURIComponent(blocked.headers.get('location')!), /删除失败/)

  const revoked = await app.request(`/admin/rbac/roles/${roleId}/revoke`, {
    method: 'POST', headers: { ...headers, ...form }, body: 'adminId=' + adminId,
  }, env)
  assert.match(decodeURIComponent(revoked.headers.get('location')!), /已撤销管理员 #/)
  assert.equal(shim.admins[0]!.role, 'admin')

  const deleted = await app.request(`/admin/rbac/roles/${roleId}/delete`, {
    method: 'POST', headers: { ...headers },
  }, env)
  assert.match(decodeURIComponent(deleted.headers.get('location')!), /角色已删除/)
  assert.equal(shim.roles.length, 0)
})

test('hasRole 通过 JWT uid 判断当前管理员角色', async () => {
  const shim = new D1Shim()
  shim.addRole('editor', 1)
  const editorId = shim.addAdmin('ed@x.com', 'editor')
  const { env } = await mountApp(shim, null)

  const mk = (cookie?: string) => ({
    req: { raw: new Request('http://x/', { headers: cookie ? { cookie: 'admin_session=' + cookie } : {} }) },
    env,
    get: (key: string) => key === 'tenant' ? { id: 1 } : undefined,
  } as any)

  // 有 editor 角色的会话
  const editorCookie: string = await cookieFor(editorId)
  assert.equal(await hasRole(mk(editorCookie), 'editor'), true)
  assert.equal(await hasRole(mk(editorCookie), 'writer'), false)

  // 无会话(空 cookie)
  assert.equal(await hasRole(mk(), 'editor'), false)

  // 内置 admin 会话隐含自定义角色
  const rootId = shim.addAdmin('root@x.com', 'admin')
  const rootCookie: string = await cookieFor(rootId)
  assert.equal(await hasRole(mk(rootCookie), 'editor'), true)
})

test('getAdminRole 读取管理员当前角色', async () => {
  const shim = new D1Shim()
  const env = makeEnv(shim)
  const adminId = shim.addAdmin('a@x.com', 'editor')
  assert.equal(await getAdminRole(env, adminId), 'editor')
  assert.equal(await getAdminRole(env, 999), null)
})
