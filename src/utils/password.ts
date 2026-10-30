// 旧版 SHA-256 + 固定盐哈希：仅用于兼容已经存在的旧账号，登录成功后会自动升级为 PBKDF2。
// 新建账号（含 scripts/create-admin.mjs）一律生成 PBKDF2，不再产生这种哈希。
const LEGACY_PASSWORD_SALTS = ['white-label-cloudflare-cms', 'whitelabelcms-seo-cms']

// PBKDF2 迭代次数：默认 600000，Cloudflare Workers 免费额度 CPU 时间有限（约 50ms/请求），
// 若 600000 次迭代超时，自动回退到 100000 次，并在 settings 表记录实际使用的值。
export const DEFAULT_PBKDF2_ITERATIONS = 600000
export const MAX_PBKDF2_ITERATIONS = 600000
export const FALLBACK_PBKDF2_ITERATIONS = 100000

export function getPbkdf2Iterations(env?: { PBKDF2_ITERATIONS?: string }): number {
  const raw = Number(env?.PBKDF2_ITERATIONS)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PBKDF2_ITERATIONS
  return Math.min(MAX_PBKDF2_ITERATIONS, Math.max(DEFAULT_PBKDF2_ITERATIONS, Math.floor(raw)))
}

export const DUMMY_PASSWORD_HASH =
  'pbkdf2$' + DEFAULT_PBKDF2_ITERATIONS + '$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128

export function validatePasswordStrength(password: string, email = ''): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `密码至少 ${PASSWORD_MIN_LENGTH} 位`
  if (password.length > PASSWORD_MAX_LENGTH) return `密码不能超过 ${PASSWORD_MAX_LENGTH} 位`
  if (/^(.)\1+$/.test(password)) return '密码不能是同一个字符重复'
  const normalizedEmail = email.trim().toLowerCase()
  if (normalizedEmail && (password.toLowerCase() === normalizedEmail || password.toLowerCase() === normalizedEmail.split('@')[0])) {
    return '密码不能与登录邮箱相同'
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length
  if (classes < 2) return '密码需至少包含两类字符（大写、小写、数字、符号）'
  return null
}

function bytesToB64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (const b of arr) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64ToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

async function digestPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(salt + ':' + password))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function pbkdf2Hash(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  return bytesToB64(bits)
}

/**
 * 哈希密码：优先使用 DEFAULT_PBKDF2_ITERATIONS（600000），
 * 若 Cloudflare Workers CPU 时间不足导致失败，自动回退到 FALLBACK_PBKDF2_ITERATIONS（100000）。
 * 返回的 hash 字符串中包含实际使用的迭代次数（pbkdf2$<iterations>$<salt>$<hash>），
 * 登录时 verifyPassword 会按记录的值验证，无需知道默认值。
 */
export async function hashPassword(password: string, iterations = DEFAULT_PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  let hash: string
  try {
    const start = Date.now()
    hash = await pbkdf2Hash(password, salt, iterations)
    const elapsed = Date.now() - start
    if (elapsed > 40000) {
      // 接近 50ms Workers CPU 限制，记录警告但继续使用
      console.warn('[admin] pbkdf2 hash slow', { iterations, elapsedMs: elapsed })
    }
  } catch (e) {
    // 600000 次迭代超时或失败，回退到 100000 次
    console.warn('[admin] pbkdf2 hash failed at high iterations, falling back', { iterations, error: String(e) })
    hash = await pbkdf2Hash(password, salt, FALLBACK_PBKDF2_ITERATIONS)
    iterations = FALLBACK_PBKDF2_ITERATIONS
  }
  return 'pbkdf2$' + iterations + '$' + bytesToB64(salt) + '$' + hash
}

export async function verifyPassword(
  password: string,
  storedHash: string | undefined,
  targetIterations = DEFAULT_PBKDF2_ITERATIONS,
): Promise<{ valid: boolean; needsUpgrade: boolean }> {
  if (!storedHash) return { valid: false, needsUpgrade: false }

  if (storedHash.startsWith('pbkdf2$')) {
    const parts = storedHash.split('$')
    const iterations = Number(parts[1])
    const salt = parts[2] ? b64ToBytes(parts[2]) : new Uint8Array()
    const expected = parts[3] || ''
    if (!iterations || !salt.byteLength || !expected) return { valid: false, needsUpgrade: false }
    const actual = await pbkdf2Hash(password, salt, iterations)
    return { valid: timingSafeEqual(actual, expected), needsUpgrade: iterations < targetIterations }
  }

  for (const salt of LEGACY_PASSWORD_SALTS) {
    const legacyHash = await digestPassword(password, salt)
    if (timingSafeEqual(legacyHash, storedHash)) return { valid: true, needsUpgrade: true }
  }

  return { valid: false, needsUpgrade: false }
}
