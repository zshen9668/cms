import { safeError } from './safeLogger'
import type { Bindings } from '../types'

const PREFIX = 'v1'
const textEncoder = new TextEncoder()

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (const byte of arr) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function getKey(env: Pick<Bindings, 'CACHE_KV'>): Promise<CryptoKey> {
  if (!env.CACHE_KV) throw new Error('CACHE_KV 未绑定，无法读写加密密钥')
  let secret = await env.CACHE_KV.get('protected-secrets:key')
  if (!secret) {
    secret = b64(crypto.getRandomValues(new Uint8Array(32)))
    await env.CACHE_KV.put('protected-secrets:key', secret)
  }
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(secret))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** 系统级密钥固定归属默认租户，读写都必须带 tenant_id=1，避免多租户下串读。 */
const SECRET_TENANT_ID = 1

export async function saveProtectedSecret(
  env: Pick<Bindings, 'DB' | 'CACHE_KV'>,
  name: string,
  value: string,
): Promise<void> {
  const clean = String(value || '').trim()
  if (!clean) {
    await env.DB.prepare('DELETE FROM settings WHERE key=? AND tenant_id=?').bind('secret:' + name, SECRET_TENANT_ID).run()
    return
  }
  const key = await getKey(env)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(clean))
  const packed = PREFIX + '.' + b64(iv) + '.' + b64(ciphertext)
  // settings 表为 (key, tenant_id) 复合主键；机密固定写入默认租户
  await env.DB.prepare(
    'INSERT INTO settings (key,value,tenant_id) VALUES (?,?,?) ON CONFLICT(key, tenant_id) DO UPDATE SET value=excluded.value'
  ).bind('secret:' + name, packed, SECRET_TENANT_ID).run()
}

export async function getProtectedSecret(
  env: Pick<Bindings, 'DB' | 'CACHE_KV'>,
  name: string,
): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key=? AND tenant_id=?').bind('secret:' + name, SECRET_TENANT_ID).first() as any
  const packed = String(row?.value || '').trim()
  if (!packed) return ''
  const parts = packed.split('.')
  if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) return ''
  try {
    const key = await getKey(env)
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(parts[1]) }, key, unb64(parts[2]))
    return new TextDecoder().decode(plaintext)
  } catch (error) {
    safeError('protected secret decrypt failed', error, { name })
    return ''
  }
}

export async function hasProtectedSecret(
  env: Pick<Bindings, 'DB' | 'CACHE_KV'>,
  name: string,
): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 FROM settings WHERE key=? AND tenant_id=? LIMIT 1').bind('secret:' + name, SECRET_TENANT_ID).first()
  return !!row
}
