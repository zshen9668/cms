// 轻量级会话 token:HMAC-SHA256 签名,避免引入额外依赖包
import { getSystemSecret } from './systemSecrets'
import type { Bindings } from '../types'

/** 字符串常量时间比较 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return bytesToBase64Url(sig)
}

export async function signToken(payload: Record<string, unknown>, secret: string, ttlSeconds = 60 * 60 * 24 * 7): Promise<string> {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }
  const json = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(body)))
  const sig = await hmac(secret, json)
  return `${json}.${sig}`
}

export async function verifyToken(token: string | undefined, secret: string): Promise<Record<string, unknown> | null> {
  if (!token) return null
  const [json, sig] = token.split('.')
  if (!json || !sig) return null
  const expected = await hmac(secret, json)
  if (!timingSafeEqual(expected, sig)) return null
  try {
    const padded = json.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((json.length + 3) % 4)
    const payload = JSON.parse(atob(padded))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function getCookie(req: Request, name: string): string | undefined {
  const cookie = req.headers.get('cookie') || ''
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  const raw = match?.[1]
  if (!raw) return undefined
  // 畸形百分号编码(如 "admin_session=%")会让 decodeURIComponent 抛出 URIError；
  // 该函数在鉴权与 CSRF 中间件里位于 try 之外，必须在此兜底，否则整个请求 500。
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** 从 cookie 字符串（而非 Request 对象）获取指定 cookie 值，避免 Workers body stream 被重复读取 */
export function getCookieFromString(cookieHeader: string | undefined | null, name: string): string | undefined {
  const cookie = cookieHeader || ''
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  const raw = match?.[1]
  if (!raw) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * 使用 KV 原子操作确保 JWT Secret 只初始化一次
 * 解决并发 setup 时可能生成不同 secret 的竞态问题
 *
 * 密钥来源优先级：
 *   1. 后台「系统设置 → 系统密钥 → 登录会话签名密钥」（加密存 D1）
 *   2. Cloudflare Worker Secret `JWT_SECRET`（兼容旧部署）
 *   3. 在 CACHE_KV 中自动生成并持久化（零配置兜底）
 */
export async function getJwtSecret(env: { JWT_SECRET?: string; CACHE_KV?: KVNamespace; DB?: D1Database }): Promise<string> {
  if (env.DB) {
    const configured = await getSystemSecret(env as unknown as Bindings, 'JWT_SECRET')
    if (configured) return configured
  }
  if (env.JWT_SECRET) return env.JWT_SECRET
  if (!env.CACHE_KV) {
    throw new Error('登录密钥未配置且 CACHE_KV 未绑定，无法安全初始化会话密钥')
  }

  const secretKey = '__cms_jwt_secret'
  const lockKey = '__cms_jwt_secret_init_lock'

  // 先尝试直接获取已存在的 secret
  let existing = await env.CACHE_KV.get(secretKey)
  if (existing && existing.length >= 32) {
    return existing
  }

  // 使用简单的锁机制：尝试设置锁，如果已存在则等待
  const lockValue = `${Date.now()}-${crypto.getRandomValues(new Uint8Array(8)).join('')}`
  await env.CACHE_KV.put(lockKey, lockValue, { expirationTtl: 60 })

  // 简单的锁检查：如果锁已存在且值不同，说明其他实例在初始化
  const currentLock = await env.CACHE_KV.get(lockKey)
  if (currentLock !== lockValue) {
    // 其他实例持有锁，等待
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 100))
      existing = await env.CACHE_KV.get(secretKey)
      if (existing && existing.length >= 32) {
        return existing
      }
    }
    // 兜底生成
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const generated = bytesToBase64Url(bytes)
    await env.CACHE_KV.put(secretKey, generated)
    return generated
  }

  // 当前实例持有锁，负责初始化
  try {
    // 双重检查
    existing = await env.CACHE_KV.get(secretKey)
    if (!existing || existing.length < 32) {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      existing = bytesToBase64Url(bytes)
      await env.CACHE_KV.put(secretKey, existing)
    }
    return existing!
  } finally {
    // 释放锁
    await env.CACHE_KV.delete(lockKey)
  }
}