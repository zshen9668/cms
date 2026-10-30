// 使用 Google 服务账号 JSON（在 GCP 创建，开通 Indexing API 并把服务账号加为 Search Console 网站的"所有者"）
// 通过 RS256 签名换取 access_token，再调用 Indexing API 推送 URL。
// 全程只用 Web Crypto，不依赖 Node 的 crypto / googleapis 包，Workers 环境可直接跑。

type ServiceAccount = { client_email: string; private_key: string }

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function getAccessToken(sa: ServiceAccount, scope: string): Promise<string | null> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: sa.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const jwt = `${unsigned}.${base64url(sig)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  if (!res.ok) return null
  const data: any = await res.json()
  return data.access_token || null
}

export async function submitGoogleIndexing(serviceAccountJson: string, urls: string[]): Promise<{ ok: boolean; results?: number[]; error?: string }> {
  let sa: ServiceAccount
  try {
    sa = JSON.parse(serviceAccountJson)
  } catch {
    return { ok: false, error: 'GOOGLE_SERVICE_ACCOUNT_JSON 格式不是合法 JSON' }
  }
  const token = await getAccessToken(sa, 'https://www.googleapis.com/auth/indexing')
  if (!token) return { ok: false, error: '获取 Google access_token 失败，请检查服务账号权限' }

  const statuses: number[] = []
  for (const url of urls.slice(0, 10)) {
    const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type: 'URL_UPDATED' }),
    })
    statuses.push(res.status)
  }
  return { ok: true, results: statuses }
}
