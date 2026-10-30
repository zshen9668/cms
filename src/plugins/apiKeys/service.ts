import type { Bindings } from '../../types'

export type ApiKeyRow = {
  id: number
  tenant_id: number
  name: string
  key_prefix: string
  key_hash: string
  scopes: string
  expires_at: string | null
  last_used_at: string | null
  created_at: string
  [key: string]: unknown
}

export type ApiKeyResult = {
  ok: boolean
  scope?: string
  id?: number
}

function hexDigest(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** SHA-256 hex(密钥鉴权与落库共用;测试 shim 可实现 env.__sha256Hex 覆盖) */
export async function sha256Hex(value: string, env?: Bindings): Promise<string> {
  const override = (env as { __sha256Hex?: (v: string) => string } | undefined)?.__sha256Hex
  if (override) return override(value)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return hexDigest(digest)
}

/**
 * 创建密钥:32 字节随机,明文形如 sk_cms_<hex64>,库里只存 SHA-256 哈希与前 8 位前缀。
 * 完整密钥只在返回值里出现这一次(响应后请立即让用户保存),之后无法再取回。
 */
export async function createApiKey(
  env: Bindings,
  tenantId: number,
  name: string,
  scopes: string,
  expiresAt?: string | null,
): Promise<{ fullKey: string; key: ApiKeyRow }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const fullKey = 'sk_cms_' + hex
  const keyPrefix = fullKey.slice(0, 8)
  const keyHash = await sha256Hex(fullKey, env)

  const inserted = await env.DB.prepare(
    `INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, scopes, expires_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(tenantId, name, keyPrefix, keyHash, scopes, expiresAt || null).first() as any

  const row = (await env.DB.prepare(
    'SELECT * FROM api_keys WHERE id = ?',
  ).bind(Number(inserted?.id || 0)).first()) as ApiKeyRow | null
  if (!row) throw new Error('密钥创建失败:无法读取刚写入的记录')

  return { fullKey, key: row }
}

/**
 * Bearer 鉴权:先对出示的密钥做 SHA-256(即使查不到也始终哈希一次,减少时序侧信道),
 * 再按 哈希 + 租户 查库,校验过期并刷新 last_used_at。
 */
export async function authenticateBearer(env: Bindings, key: string, tenantId: number = 1): Promise<ApiKeyResult> {
  const presented = (key || '').trim()
  const keyHash = await sha256Hex(presented, env)
  if (!presented) return { ok: false }

  const row = (await env.DB.prepare(
    'SELECT * FROM api_keys WHERE key_hash = ? AND tenant_id = ?',
  ).bind(keyHash, tenantId).first()) as unknown as ApiKeyRow | null

  if (!row) return { ok: false }

  // 过期检查:D1 的 datetime 默认 UTC,expires_at 存的是 UTC 字符串(或 ISO),两边统一按时间戳比较
  if (row.expires_at) {
    const exp = Date.parse(row.expires_at)
    if (!Number.isNaN(exp) && exp < Date.now()) return { ok: false }
  }

  // 固化引用:显式持有非空引用(避免 TS 跨 await 收窄问题)
  const keyRow: ApiKeyRow = row as ApiKeyRow
  const rowId = keyRow.id
  const rowScopes = String(keyRow.scopes || 'read')

  try {
    await env.DB.prepare('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?')
      .bind(rowId).run()
  } catch {
    // last_used 更新失败不影响鉴权结果
  }

  const scope = rowScopes.split(',')[0]?.trim() || 'read'
  return { ok: true, scope, id: rowId }
}

/** 吊销:只允许吊销属于指定租户的密钥,防止跨租户删除 */
export async function revokeApiKey(env: Bindings, keyId: number, tenantId: number): Promise<void> {
  await env.DB.prepare('DELETE FROM api_keys WHERE id = ? AND tenant_id = ?').bind(keyId, tenantId).run()
}

/** 列表:只回展示列,绝不带 key_hash */
export async function listApiKeys(env: Bindings, tenantId: number): Promise<
  Omit<ApiKeyRow, 'key_hash'>[]
> {
  const { results } = await env.DB.prepare(
    'SELECT id, tenant_id, name, key_prefix, scopes, expires_at, last_used_at, created_at FROM api_keys WHERE tenant_id = ? ORDER BY id DESC',
  ).bind(tenantId).all()
  return (results || []) as unknown as Omit<ApiKeyRow, 'key_hash'>[]
}
