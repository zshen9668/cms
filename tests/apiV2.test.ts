import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { apiV2Routes } from '../src/routes/apiV2.ts'
import { createApiKey } from '../src/plugins/apiKeys/service.ts'

/** 最小 D1 + KV shim:支持 apiKeys 服务的 INSERT(RETURNING)/SELECT/UPDATE/DELETE */
function makeD1() {
  const rows: Record<string, any[]> = { api_keys: [] }
  let seq = 0
  const db: any = {
    prepare(sql: string) {
      return {
        bind(...vals: any[]) {
          const s = sql.trim()
          return {
            async all() {
              if (/SELECT .*FROM api_keys WHERE key_hash = \? AND tenant_id = \?/i.test(s)) {
                return { results: (rows.api_keys || []).filter((r) => r.key_hash === vals[0] && r.tenant_id === vals[1]) }
              }
              if (/SELECT .*FROM api_keys WHERE id = \?/i.test(s)) {
                return { results: (rows.api_keys || []).filter((r) => r.id === Number(vals[0])) }
              }
              if (/SELECT .*FROM api_keys WHERE tenant_id = \?/i.test(s)) {
                return { results: (rows.api_keys || []).filter((r) => r.tenant_id === vals[0]) }
              }
              // 业务表(articles/cities):测试环境无数据,返回空
              return { results: [] }
            },
            async first() {
              // INSERT ... RETURNING id:返回刚插入的行
              if (/INSERT INTO api_keys/i.test(s) && /RETURNING/i.test(s)) {
                const row = {
                  tenant_id: vals[0], name: vals[1], key_prefix: vals[2], key_hash: vals[3],
                  scopes: vals[4], expires_at: vals[5], last_used_at: null,
                  id: ++seq, created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
                }
                ;(rows.api_keys ||= []).push(row)
                return row
              }
              const r = await this.all()
              return (r as any).results[0] ?? null
            },
            async run() {
              if (/INSERT INTO api_keys/i.test(s)) {
                const row = {
                  tenant_id: vals[0], name: vals[1], key_prefix: vals[2], key_hash: vals[3],
                  scopes: vals[4], expires_at: vals[5], last_used_at: null,
                  id: ++seq, created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
                }
                ;(rows.api_keys ||= []).push(row)
                return { meta: { changes: 1, last_row_id: row.id } }
              }
              if (/UPDATE api_keys SET last_used_at/i.test(s)) {
                const target = (rows.api_keys || []).find((r) => r.id === Number(vals[0]))
                if (target) target.last_used_at = new Date().toISOString().slice(0, 19).replace('T', ' ')
                return { meta: { changes: target ? 1 : 0 } }
              }
              if (/DELETE FROM api_keys/i.test(s)) {
                rows.api_keys = (rows.api_keys || []).filter((r) => r.id !== Number(vals[0]))
                return { meta: { changes: 1 } }
              }
              return { meta: { changes: 0 } }
            },
          }
        },
      }
    },
  }
  return { db, rows }
}

function makeEnv(d1: ReturnType<typeof makeD1>) {
  const env: any = {
    DB: d1.db,
    CACHE_KV: { get: async () => '0', put: async () => {}, delete: async () => {} },
    // 确定性哈希,避免依赖 crypto.subtle
    __sha256Hex: async (v: string) => {
      let h = 0
      for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) | 0
      return 'h' + (h >>> 0).toString(16)
    },
  }
  return env
}

/** 挂载一个带 env 的 Hono app,供 apiV2Routes 通过 c.env 读取绑定 */
function mountApp(env: any) {
  const app = new Hono()
  app.route('/api/v2', apiV2Routes)
  ;(app as any).get = (app as any).get.bind(app)
  const handler = app.fetch.bind(app)
  return async (path: string, opts: { authorization?: string } = {}) => {
    const req = new Request('https://x.test' + path, {
      headers: opts.authorization ? { authorization: opts.authorization } : {},
    })
    const res = await handler(req, env, {})
    return res
  }
}

test('/api/v2 无 Bearer 密钥 → 401', async () => {
  const d1 = makeD1()
  const env = makeEnv(d1)
  const fetch = mountApp(env)
  const res = await fetch('/api/v2/articles')
  assert.equal(res.status, 401)
})

test('/api/v2 有效 read 密钥放行,查询走 DB', async () => {
  const d1 = makeD1()
  const env = makeEnv(d1)
  const { fullKey } = await createApiKey(env, 1, 'test-key', 'read')
  const fetch = mountApp(env)
  const res = await fetch('/api/v2/articles', { authorization: 'Bearer ' + fullKey })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(typeof body.count, 'number')
})

test('/api/v2 无效密钥 → 401', async () => {
  const d1 = makeD1()
  const env = makeEnv(d1)
  const fetch = mountApp(env)
  const res = await fetch('/api/v2/articles', { authorization: 'Bearer sk_cms_doesnotexist' })
  assert.equal(res.status, 401)
})
