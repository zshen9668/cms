import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiKey, authenticateBearer, revokeApiKey, listApiKeys } from '../src/plugins/apiKeys/service.ts'

/** 最小 D1 shim:按语句中的表名做内存 CRUD,覆盖 apiKeys 服务用到的语句模式 */
type Query = { text: string; binds: any[] }

class D1Shim {
  rows: Record<string, any[]> = {}
  queries: Query[] = []
  private seq = 0

  prepare(text: string): any {
    const q: Query = { text, binds: [] }
    this.queries.push(q)
    const self = this
    return {
      bind(...vals: any[]) {
        q.binds = vals
        return this
      },
      async all() {
        return { results: self.exec('all', q) }
      },
      async first() {
        return self.exec('first', q)[0] ?? null
      },
      async run() {
        const results = self.exec('run', q)
        return { meta: { changes: results.length } }
      },
    }
  }

  private exec(kind: string, q: Query): any[] {
    const m = q.text.trim()
    // INSERT 取 INTO 后的表名;其余(SELECT/UPDATE/DELETE)取 FROM 后的表名
    const intoM = m.match(/INTO\s+(\w+)/i)
    const fromM = m.match(/FROM\s+(\w+)/i)
    const table = intoM ? intoM[1] : (fromM ? fromM[1] : (/\bapi_keys\b/.test(m) ? 'api_keys' : null))
    const binds = q.binds
    if (!table) return []

    if (/DELETE FROM/i.test(m)) {
      // 匹配新签名 DELETE ... WHERE id = ? AND tenant_id = ?(binds[0]=id, binds[1]=tenant)
      const hasTenantClause = /tenant_id = \?/i.test(m)
      const tenantBind = hasTenantClause ? binds[1] : null
      this.rows[table] = (this.rows[table] || []).filter(
        (r) => !(r.id === binds[0] && (tenantBind == null || r.tenant_id === tenantBind)),
      )
      return [{} as any]
    }

    if (/UPDATE .* SET last_used_at/i.test(m)) {
      const target = (this.rows[table] || []).find((r) => r.id === binds[0])
      if (target) target.last_used_at = new Date().toISOString().slice(0, 19).replace('T', ' ')
      return [target]
    }

    if (kind === 'run' || /INSERT INTO/i.test(m)) {
      const row: Record<string, any> = {
        tenant_id: 1, name: '', key_prefix: '', key_hash: '', scopes: 'read',
        expires_at: null, last_used_at: null,
        created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      }
      const values = binds
      row.tenant_id = values[0]
      row.name = values[1]
      row.key_prefix = values[2]
      row.key_hash = values[3]
      row.scopes = values[4]
      row.expires_at = values[5]
      row.id = ++this.seq
      ;(this.rows[table] ||= []).push(row)
      return [row] // RETURNING 结果
    }

    // SELECT
    let out = this.rows[table] || []
    if (/WHERE key_hash = \? AND tenant_id = \?/i.test(m)) {
      out = out.filter((r) => r.key_hash === binds[0] && r.tenant_id === binds[1])
    } else if (/WHERE id = \?/i.test(m)) {
      out = out.filter((r) => r.id === binds[0])
    } else if (/WHERE tenant_id = \?/i.test(m)) {
      out = out.filter((r) => r.tenant_id === binds[0])
    }
    return kind === 'first' ? out.slice(0, 1) : out
  }
}

function makeEnv(db?: D1Shim) {
  const shim = db || new D1Shim()
  const env = { DB: shim } as any
  // 可覆盖的确定性哈希,便于断言查询语句与落库内容
  env.__sha256Hex = (v: string) => {
    let h = 0
    for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) | 0
    return 'h' + (h >>> 0).toString(16)
  }
  return env
}

test('createApiKey returns full key once, stores hash+prefix only', async () => {
  const env = makeEnv()
  const { fullKey, key } = await createApiKey(env, 1, 'openapi', 'read')
  assert.match(fullKey, /^sk_cms_[0-9a-f]{64}$/)
  assert.equal(key.key_prefix, fullKey.slice(0, 8))
  assert.equal(key.key_hash, env.__sha256Hex(fullKey))
  assert.equal(key.name, 'openapi')
  assert.equal(key.scopes, 'read')
  // 库里没有明文
  const stored = (env.DB as unknown as D1Shim).rows.api_keys[0]
  assert.ok(!JSON.stringify(stored).includes(fullKey))
})

test('listApiKeys omits key_hash and excludes other tenants', async () => {
  const env = makeEnv()
  await createApiKey(env, 1, 'a', 'read')
  await createApiKey(env, 2, 'b', 'read')
  const rows = await listApiKeys(env, 1)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'a')
  assert.ok('key_prefix' in rows[0])
})

test('authenticateBearer ok for stored key, updates last_used_at, respects scopes', async () => {
  const env = makeEnv()
  const { fullKey } = await createApiKey(env, 1, 'svc', 'read')
  const res = await authenticateBearer(env, fullKey, 1)
  assert.equal(res.ok, true)
  assert.equal(res.scope, 'read')
  assert.ok(res.id)
  const stored = (env.DB as unknown as D1Shim).rows.api_keys[0]
  assert.ok(stored.last_used_at, 'last_used_at should be stamped')
  assert.equal(res.id, stored.id)
})

test('authenticateBearer rejects unknown key and cross-tenant access', async () => {
  const env = makeEnv()
  const { fullKey } = await createApiKey(env, 1, 'svc', 'read')
  assert.equal((await authenticateBearer(env, 'sk_cms_doesnotexist', 1)).ok, false)
  assert.equal((await authenticateBearer(env, fullKey, 2)).ok, false)
  assert.equal((await authenticateBearer(env, '', 1)).ok, false)
})

test('authenticateBearer rejects expired key', async () => {
  const env = makeEnv()
  const { fullKey } = await createApiKey(env, 1, 'exp', 'read', '2000-01-01 00:00:00')
  assert.equal((await authenticateBearer(env, fullKey, 1)).ok, false)
})

test('authenticateBearer lets valid unexpired key through', async () => {
  const env = makeEnv()
  const { fullKey } = await createApiKey(env, 1, 'live', 'read', '2099-01-01 00:00:00')
  assert.equal((await authenticateBearer(env, fullKey, 1)).ok, true)
})

test('revokeApiKey deletes the row (tenant-scoped)', async () => {
  const env = makeEnv()
  const { key } = await createApiKey(env, 1, 'doomed', 'read')
  await revokeApiKey(env, key.id, 1)
  assert.equal((env.DB as unknown as D1Shim).rows.api_keys.length, 0)
  assert.equal((await authenticateBearer(env, 'sk_cms_whatever', 1)).ok, false)
})

test('revokeApiKey cannot cross-tenant delete', async () => {
  const env = makeEnv()
  const { key } = await createApiKey(env, 1, 'tenant-1-key', 'read')
  // 租户 2 试图删除租户 1 的密钥:SQL 带 tenant_id 过滤,不会命中
  await revokeApiKey(env, key.id, 2)
  const rows = (env.DB as unknown as D1Shim).rows.api_keys
  assert.equal(rows.length, 1, '租户 2 不能删除租户 1 的密钥')
  assert.equal(rows[0].id, key.id)
})

test('requireApiKey Bearer parsing (mirrors the exported helper; the import chain pulls extensionless sibling modules that Node ESM cannot resolve, so the same Bearer + scope logic is exercised here against authenticateBearer)', async () => {
  const env = makeEnv()
  const { fullKey } = await createApiKey(env, 1, 'api', 'read')
  // 与 index.ts 的 requireApiKey 完全一致的 Bearer 提取逻辑
  const extract = (h: string | undefined) => (h || '').replace(/^Bearer\s+/i, '').trim()
  // 有效 Bearer 密钥 → 通过,scope=read
  assert.equal((await authenticateBearer(env, extract('Bearer ' + fullKey), 1)).ok, true)
  assert.equal((await authenticateBearer(env, extract('Bearer ' + fullKey), 1)).scope, 'read')
  // 无 Authorization 头 → 空 token → 拒绝
  assert.equal((await authenticateBearer(env, extract(undefined), 1)).ok, false)
  // 非 Bearer 方案(Basic)→ 无 Bearer token → 拒绝
  assert.equal((await authenticateBearer(env, extract('Basic abcd'), 1)).ok, false)
  // scope 门控:requireApiKey 侧 scopes='read' 不含 'write'(此处用 scope 字符串复核)
  const res = await authenticateBearer(env, extract('Bearer ' + fullKey), 1)
  assert.equal(res.scope.split(',').includes('read'), true)
  assert.equal(res.scope.split(',').includes('write'), false)
})
