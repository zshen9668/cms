import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { tenantRoutes } from '../src/routes/tenant.ts'
import { hashPassword, verifyPassword } from '../src/utils/password.ts'

/** 最小 D1 + KV shim:tenants/users/tenant_members + 会话存储 */
function makeD1() {
  const rows: Record<string, any[]> = { tenants: [], users: [], tenant_members: [] }
  let seq = 0
  const sessions: Record<string, any> = {}
  const kv: any = {
    get: async (k: string) => (k in sessions ? JSON.stringify(sessions[k]) : null),
    put: async (k: string, v: string, _o?: any) => { sessions[k] = JSON.parse(v) },
    delete: async (k: string) => { delete sessions[k] },
  }
  const preparedCache: any[] = []
  const db: any = {
    prepare(sql: string) {
      const m = sql.trim()
      const table = m.match(/INTO\s+(\w+)/i)?.[1] || m.match(/FROM\s+(\w+)/i)?.[1] || null
      let vals: any[] = []
      const obj: any = {
        bind(...v: any[]) { vals = v; return obj },
        async first() {
          if (/SELECT id FROM tenants WHERE slug/i.test(m)) return (rows.tenants || []).find((r: any) => r.slug === vals[0]) ?? null
          if (/SELECT id, slug, tier, status FROM tenants WHERE slug/i.test(m)) {
            const r = (rows.tenants || []).find((x: any) => x.slug === vals[0])
            return r ? { id: r.id, slug: r.slug, tier: r.tier, status: r.status } : null
          }
          if (/SELECT id, password_hash FROM users WHERE email/i.test(m)) {
            const r = (rows.users || []).find((x: any) => x.email === vals[0])
            return r ? { id: r.id, password_hash: r.password_hash } : null
          }
          if (/SELECT 1 AS ok FROM users WHERE email/i.test(m)) {
            return (rows.users || []).some((x: any) => x.email === vals[0]) ? { ok: 1 } : null
          }
          if (/SELECT u\.id, u\.password_hash FROM users u JOIN tenant_members/i.test(m)) {
            const r = (rows.users || []).find((x: any) =>
              x.email === vals[0] &&
              (rows.tenant_members || []).some((mm: any) => mm.user_id === x.id && mm.tenant_id === Number(vals[1]))
            )
            return r ? { id: r.id, password_hash: r.password_hash } : null
          }
          if (/SELECT 1 AS ok FROM tenant_members/i.test(m)) {
            return (rows.tenant_members || []).some((r: any) => r.tenant_id === Number(vals[0]) && r.user_id === Number(vals[1])) ? { ok: 1 } : null
          }
          if (/SELECT id, slug, tier, status FROM tenants WHERE id/i.test(m)) {
            const r = (rows.tenants || []).find((x: any) => x.id === Number(vals[0]))
            return r ? { id: r.id, slug: r.slug, tier: r.tier, status: r.status } : null
          }
          return null
        },
        async all() { return { results: [] } },
        async run() {
          if (/INSERT INTO tenants/i.test(m)) {
            const row = { id: ++seq, slug: vals[0], owner_email: vals[1], tier: vals[2], status: vals[3] }
            ;(rows.tenants ||= []).push(row)
            return { meta: { changes: 1, last_row_id: row.id } }
          }
          if (/INSERT INTO users/i.test(m)) {
            const row = { id: ++seq, email: vals[0], password_hash: vals[1] }
            ;(rows.users ||= []).push(row)
            return { meta: { changes: 1, last_row_id: row.id } }
          }
          if (/INSERT INTO tenant_members/i.test(m)) {
            ;(rows.tenant_members ||= []).push({ id: ++seq, tenant_id: vals[0], user_id: vals[1], role: vals[2] })
            return { meta: { changes: 1 } }
          }
          return { meta: { changes: 0 } }
        },
      }
      // batch 里每个 item 需带 run()
      preparedCache.push(obj)
      return obj
    },
    async batch(items: any[]) {
      // 真实 D1 的 batch 接受 prepared statement 数组;这里对每个 item 调其 run()
      const out: any[] = []
      for (const it of items) out.push(await it.run())
      return out
    },
  }
  return { db, kv, rows, sessions }
}

function mount(env: any) {
  const app = new Hono()
  app.route('/api', tenantRoutes)
  const fetcher = app.fetch.bind(app)
  return (path: string, init: RequestInit = {}) =>
    fetcher(new Request('https://x.test' + path, init), env, {})
}

test('POST /api/tenants 创建租户 + owner 用户 + 成员关系', async () => {
  const shim = makeD1()
  const env = { DB: shim.db, CACHE_KV: shim.kv, SITE_NAME: 'x' }
  const fetch = mount(env)
  const res = await fetch('/api/tenants', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'acme', owner_email: 'o@acme.com', password: 'a-strong-pass-123' }),
  })
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.tenant.slug, 'acme')
  assert.equal(shim.rows.tenants.length, 1)
  assert.equal(shim.rows.users.length, 1)
  assert.equal(shim.rows.tenant_members.length, 1)
})

test('POST /api/tenants 拒绝重复 slug', async () => {
  const shim = makeD1()
  shim.rows.tenants.push({ id: 1, slug: 'acme', owner_email: 'o@acme.com', tier: 'free', status: 'active' })
  const fetch = mount({ DB: shim.db, CACHE_KV: shim.kv })
  const res = await fetch('/api/tenants', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'acme', owner_email: 'o@acme.com', password: 'a-strong-pass-123' }),
  })
  assert.equal(res.status, 409)
})

test('POST /api/tenants/:slug/login 正确凭据 → 会话 token', async () => {
  const shim = makeD1()
  shim.rows.tenants.push({ id: 1, slug: 'acme', owner_email: 'o@acme.com', tier: 'free', status: 'active' })
  shim.rows.users.push({ id: 1, email: 'o@acme.com', password_hash: await hashPassword('a-strong-pass-123') })
  shim.rows.tenant_members.push({ id: 1, tenant_id: 1, user_id: 1, role: 'owner' })
  const fetch = mount({ DB: shim.db, CACHE_KV: shim.kv })
  const res = await fetch('/api/tenants/acme/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'o@acme.com', password: 'a-strong-pass-123' }),
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.ok(body.token, '应返回会话 token')
  // 限流计数器也写入 CACHE_KV，只统计真实会话条目
  const sessionCount = Object.keys(shim.sessions).filter((k) => k.startsWith('saas_session:')).length
  assert.equal(sessionCount, 1)
})

test('POST /api/tenants/:slug/login 错误密码 → 401', async () => {
  const shim = makeD1()
  shim.rows.tenants.push({ id: 1, slug: 'acme', owner_email: 'o@acme.com', tier: 'free', status: 'active' })
  shim.rows.users.push({ id: 1, email: 'o@acme.com', password_hash: await hashPassword('a-strong-pass-123') })
  shim.rows.tenant_members.push({ id: 1, tenant_id: 1, user_id: 1, role: 'owner' })
  const fetch = mount({ DB: shim.db, CACHE_KV: shim.kv })
  const res = await fetch('/api/tenants/acme/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'o@acme.com', password: 'wrong-pass-999' }),
  })
  assert.equal(res.status, 401)
})

test('GET /api/auth/me 有效 Bearer → 租户信息', async () => {
  const shim = makeD1()
  shim.rows.tenants.push({ id: 1, slug: 'acme', owner_email: 'o@acme.com', tier: 'free', status: 'active' })
  shim.rows.users.push({ id: 1, email: 'o@acme.com', password_hash: await hashPassword('a-strong-pass-123') })
  shim.rows.tenant_members.push({ id: 1, tenant_id: 1, user_id: 1, role: 'owner' })
  const fetch = mount({ DB: shim.db, CACHE_KV: shim.kv })
  // 先登录拿 token
  const login = await fetch('/api/tenants/acme/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'o@acme.com', password: 'a-strong-pass-123' }),
  })
  const token = (await login.json()).token
  // 再读 me
  const me = await fetch('/api/auth/me', { headers: { authorization: 'Bearer ' + token } })
  assert.equal(me.status, 200)
  const body = await me.json()
  assert.equal(body.ok, true)
  assert.equal(body.tenant.slug, 'acme')
})

test('GET /api/auth/me 无效 Bearer → 401', async () => {
  const shim = makeD1()
  const fetch = mount({ DB: shim.db, CACHE_KV: shim.kv })
  const me = await fetch('/api/auth/me', { headers: { authorization: 'Bearer bogus' } })
  assert.equal(me.status, 401)
})
