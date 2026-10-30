import { safeError, safeWarn } from '../utils/safeLogger'
import type { MiddlewareHandler } from 'hono'
import type { Bindings, Variables } from '../types'
import { getCookieFromString } from '../utils/auth'

/**
 * 速率限制中间件
 * 基于 Cloudflare KV 实现的简单 IP 限流
 * @param limit - 时间窗口内允许的最大请求数
 * @param windowSeconds - 时间窗口大小（秒）
 * @param scope - 限流作用域标识，用于区分不同业务场景
 * @returns Hono 中间件处理器
 */
export function rateLimit(limit = 10, windowSeconds = 60, scope = 'default'): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c, next) => {
    const kv = c.env.CACHE_KV
    if (!kv) return next()

    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
    const safeScope = String(scope || 'default').replace(/[^a-z0-9_-]/gi, '_')
    const key = 'rl:' + safeScope + ':' + ip + ':' + Math.floor(Date.now() / 1000 / windowSeconds)
    try {
      const current = parseInt((await kv.get(key)) || '0', 10)
      if (current >= limit) return c.text('请求过于频繁，请稍后重试', 429)
      await kv.put(key, String(current + 1), { expirationTtl: windowSeconds + 5 })
    } catch (e) {
      safeError('KV rate-limit failed; denying request', undefined, { scope: safeScope, error: e })
      return c.text('请求过于频繁，请稍后重试', 429)
    }
    await next()
  }
}

/** 登录失败最大允许次数 */
export const LOGIN_MAX_FAILURES = 5
/** 登录锁定时长（秒） */
export const LOGIN_LOCK_SECONDS = 15 * 60

/**
 * KV 存储接口类型
 */
type KvLike = {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * 生成登录失败记录的 KV 键
 * 使用 SHA-256 哈希保护邮箱隐私
 */
async function loginFailureKey(email: string, ip: string): Promise<string> {
  const data = new TextEncoder().encode(email.trim().toLowerCase() + '|' + ip)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return 'lf:' + hex
}

/**
 * 检查指定邮箱+IP 是否被登录锁定
 * @param kv - KV 命名空间
 * @param email - 登录邮箱
 * @param ip - 客户端 IP
 * @returns 是否被锁定
 */
export async function isLoginLocked(kv: KvLike | undefined, email: string, ip: string): Promise<boolean> {
  if (!kv) return false
  try {
    const count = parseInt((await kv.get(await loginFailureKey(email, ip))) || '0', 10)
    return count >= LOGIN_MAX_FAILURES
  } catch (e) {
    safeError('login lock check failed; locking', e)
    return true
  }
}

/**
 * 记录一次登录失败
 * 使用乐观锁重试实现原子增，防止并发竞争
 * @returns 当前失败次数
 */
export async function recordLoginFailure(kv: KvLike | undefined, email: string, ip: string): Promise<number> {
  if (!kv) return 0
  try {
    const key = await loginFailureKey(email, ip)
    // 使用乐观锁重试实现原子增：最多重试 3 次
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = parseInt((await kv.get(key)) || '0', 10)
      const next = current + 1
      await kv.put(key, String(next), { expirationTtl: LOGIN_LOCK_SECONDS })
      // 验证写入成功
      const verify = parseInt((await kv.get(key)) || '0', 10)
      if (verify === next) return next
      // 并发冲突，重试
    }
    // 兜底：返回当前值
    return parseInt((await kv.get(key)) || '0', 10)
  } catch (e) {
    safeError('login failure record failed', e)
    return 0
  }
}

/**
 * 清除登录失败记录（登录成功后调用）
 */
export async function clearLoginFailures(kv: KvLike | undefined, email: string, ip: string): Promise<void> {
  if (!kv) return
  try {
    await kv.delete(await loginFailureKey(email, ip))
  } catch (e) {
    safeError('login failure clear failed', e)
  }
}

/**
 * 判断 HTML 是否可被边缘缓存
 * 多语言页面因人而异，不应被边缘缓存
 */
export function isEdgeCacheableHtml(multilingual: boolean): boolean {
  return !multilingual
}

/**
 * 安全的管理员变更请求检查
 * 防止 CSRF 攻击：验证 Origin 和 Sec-Fetch-Site
 * @param request - HTTP 请求对象
 * @returns 是否通过安全检查
 */
interface RequestLike {
  url: string
  method: string
  headers: { get: (name: string) => string | null }
}

export function isSafeAdminMutationRequest(request: RequestLike): boolean {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()
  const needsOriginCheck = url.pathname.startsWith('/admin') || url.pathname === '/contact'
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !needsOriginCheck) return true

  const fetchSite = request.headers.get('sec-fetch-site') || ''
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false

  const origin = request.headers.get('origin') || ''
  if (origin) {
    try {
      if (new URL(origin).origin !== url.origin) return false
    } catch {
      return false
    }
  } else if (fetchSite === 'cross-site') {
    // 跨站请求没有 Origin 头，拒绝
    return false
  }

  return true
}

/**
 * CSRF 保护(Double Submit Cookie 模式)。
 *
 * - `csrf_token` cookie 由 ensureCsrfCookie 下发,**刻意不带 HttpOnly**:
 *   双提交成立的前提就是"客户端能把同一个值再回传一次",JS 必须读得到它。
 *   它仍然带 Secure + SameSite=Lax,跨站 POST 根本不会携带,跨站请求进不了这道门。
 * - 变更请求必须回传同一个 token:优先 `X-CSRF-Token` 请求头,其次表单隐藏字段 `_csrf`。
 * - 后台 17 个模板文件里共 129 个表单,**不在源码里逐个手写隐藏字段**,而是由
 *   `renderAdminLayout` 统一注入一段引导脚本在浏览器端补齐(含 JS 动态创建的表单),
 *   并由它给 fetch 的 POST 补上请求头。这样新增表单不会因为"忘了加字段"而在提交时 403。
 * - 校验是**严格**的:token 不匹配一律 403。Origin / Sec-Fetch-Site 只作为额外的
 *   拒绝条件(第二道门),不再充当"没有 token 也放行"的回退路径。
 */
export const CSRF_COOKIE_NAME = 'csrf_token'
export const CSRF_HEADER_NAME = 'x-csrf-token'
export const CSRF_FIELD_NAME = '_csrf'
export const CSRF_TTL = 24 * 60 * 60

async function generateCsrfToken(): Promise<string> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 验证 CSRF token（从 header 或 body 获取）
 */
export async function validateCsrfToken(c: any, tokenFromCookie: string): Promise<boolean> {
  // 安全方法不需要 CSRF 保护，且绝对不读取请求体，避免 "Body has already been used"
  const method = c.req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true
  }

  // 优先从 header 获取
  const headerToken = c.req.header(CSRF_HEADER_NAME)
  if (headerToken) {
    return timingSafeEqual(headerToken, tokenFromCookie)
  }

  // 尝试从 body 获取（form-data 或 json）
  try {
    const contentType = c.req.header('content-type') || ''
    if (contentType.includes('application/json')) {
      const body = await c.req.json()
      const bodyToken = body[CSRF_FIELD_NAME] || body.csrf_token
      if (bodyToken) return timingSafeEqual(bodyToken, tokenFromCookie)
    } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData()
      const bodyToken = formData.get(CSRF_FIELD_NAME) || formData.get('csrf_token')
      if (bodyToken) return timingSafeEqual(String(bodyToken), tokenFromCookie)
    }
  } catch {
    // 解析失败视为无效
  }
  return false
}

/**
 * CSRF 保护中间件:应用于所有 /admin 变更端点。
 *
 * 两道门,任一不过都拒绝:
 *  1. 来源门:Origin / Sec-Fetch-Site 存在且指向外部时直接 403(即便 token 正确)。
 *  2. 令牌门:cookie 里的 `csrf_token` 必须与请求回传的 token 一致。
 *     回传位置:`X-CSRF-Token` 请求头,或表单隐藏字段 `_csrf`(JSON 体里为 `_csrf` 字段)。
 *
 * 这里**没有**"没有 token 就退回 Origin 检查"的放行分支:那种回退等于把 CSRF 防护
 * 降级成一个头部检查,任何能伪造同源来源头的场景都能绕过。后台表单的隐藏字段由
 * `renderAdminLayout` 的引导脚本统一补齐,所以严格校验不会让正常表单提交失败。
 */
export function csrfProtection(): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c, next) => {
    const path = c.req.path
    const method = c.req.method.toUpperCase()

    // 仅保护 /admin 下的 POST/PUT/PATCH/DELETE
    if (!path.startsWith('/admin') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next()
    }

    // 登录/初始化/恢复页面不需要 CSRF(此时还没有会话,且各自有限流与令牌保护)
    if (path === '/admin/login' || path === '/admin/setup' || path === '/admin/recover') {
      return next()
    }

    // 来源门先做:不读请求体,跨站请求能更早被挡掉。
    const originOk = isSafeAdminMutationRequest({
      url: c.req.url,
      method: c.req.method,
      headers: { get: (name: string) => c.req.header(name) || '' },
    })
    if (!originOk) {
      safeWarn('CSRF origin check failed', { path, ip: c.req.header('cf-connecting-ip') })
      return c.text('请求来源无效', 403)
    }

    const cookieToken = getCookieFromString(c.req.header('cookie'), CSRF_COOKIE_NAME) || c.get('csrfToken')
    if (!cookieToken) {
      safeWarn('CSRF token missing from cookie', { path, ip: c.req.header('cf-connecting-ip') })
      return c.text('CSRF 令牌缺失', 403)
    }

    const isValid = await validateCsrfToken(c, cookieToken)
    if (!isValid) {
      safeWarn('CSRF token validation failed', { path, ip: c.req.header('cf-connecting-ip') })
      return c.text('CSRF 令牌无效', 403)
    }

    await next()
  }
}

/**
 * 下发 CSRF 双提交 cookie(仅在缺失时)。
 *
 * **刻意不带 HttpOnly**:双提交要求客户端把同一个 token 再回传一次,后台外壳的引导脚本
 * 需要读它来填表单隐藏字段、给 fetch 补请求头;加上 HttpOnly 这两个动作都做不到。
 * 安全性由 Secure + SameSite=Lax + 服务端严格比对共同保证:跨站请求不会携带该 cookie。
 */
export function ensureCsrfCookie(): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c, next) => {
    // 首次请求时 cookie 为空，先生成 token 并写入响应头 + c.set，供本次请求的路由模板使用
    // 后续请求时 cookie 已存在，仍从 cookie 读取并设入 c.set，确保 c.get('csrfToken') 始终可用
    const existingToken = getCookieFromString(c.req.header('cookie'), CSRF_COOKIE_NAME)
    if (!existingToken) {
      const token = await generateCsrfToken()
      c.res.headers.append(
        'Set-Cookie',
        CSRF_COOKIE_NAME + '=' + token + '; Path=/; Secure; SameSite=Lax; Max-Age=' + CSRF_TTL,
      )
      c.set('csrfToken' as any, token)
    } else {
      c.set('csrfToken' as any, existingToken)
    }
    await next()
  }
}

/**
 * 常量时间比较，防止时序攻击
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

/**
 * 安全响应头中间件
 * 设置 CSP、X-Frame-Options、Referrer-Policy 等安全头
 */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  // 为本次请求生成 CSP nonce，供模板注入到内联 <script> 标签，
  // 并在响应头 Content-Security-Policy 中使用同一个值。
  const nonceBytes = new Uint8Array(16)
  crypto.getRandomValues(nonceBytes)
  const cspNonce = Array.from(nonceBytes, (b) => b.toString(16).padStart(2, '0')).join('')
  c.set('cspNonce', cspNonce)

  // Only check origin for mutation methods (POST, PUT, PATCH, DELETE) on admin/contact
  // Safe methods (GET, HEAD, OPTIONS) should not be blocked
  const method = c.req.method.toUpperCase()
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!isSafeAdminMutationRequest({
      url: c.req.url,
      method: c.req.method,
      headers: { get: (name: string) => c.req.header(name) || '' }
    })) return c.text('请求来源无效', 403)
  }

  await next()

  const res = c.res
  if (!res) return
  const path = c.req.path
  const isPrivate = path.startsWith('/admin') || path.startsWith('/api') || path === '/healthz'
  if (isPrivate) {
    res.headers.set('Cache-Control', 'no-store, max-age=0')
    res.headers.set('Cloudflare-CDN-Cache-Control', 'no-store')
  } else if (
    c.req.method === 'GET' &&
    res.status === 200 &&
    res.headers.get('content-type')?.includes('text/html')
  ) {
    if (!isEdgeCacheableHtml((c as any).get('multilingual') === true)) {
      res.headers.set('Cache-Control', 'private, no-store')
      res.headers.set('Cloudflare-CDN-Cache-Control', 'no-store')
    } else {
      res.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=300')
      res.headers.set('Cloudflare-CDN-Cache-Control', 'public, max-age=300, stale-while-revalidate=60')
      res.headers.set('Cache-Tag', 'whitelabel-cms-public')
      res.headers.set('Vary', 'Cookie')
    }
  }

  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'SAMEORIGIN')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()')
  res.headers.set('X-Permitted-Cross-Domain-Policies', 'none')
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin')

  // Content-Security-Policy：内联脚本仅允许携带本次请求的 nonce；
  // 内联样式也需 nonce，否则前台卡片/横幅等内联 <style> 会被拦截。
  // Turnstile 人机校验脚本来自 challenges.cloudflare.com，需显式放行。
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${cspNonce}' https://challenges.cloudflare.com`,
    `style-src 'self' 'nonce-${cspNonce}'`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
  ].join('; ')
  res.headers.set('Content-Security-Policy', csp)
}

