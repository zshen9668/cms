import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { isSafeAdminMutationRequest, csrfProtection, ensureCsrfCookie } from '../src/middleware/security.ts'

test('allows same-origin admin mutations', () => {
  const request = new Request('https://example.com/admin/settings', {
    method: 'POST',
    headers: { Origin: 'https://example.com', 'Sec-Fetch-Site': 'same-origin' },
  })
  assert.equal(isSafeAdminMutationRequest(request), true)
})

test('rejects cross-site fetch metadata', () => {
  const request = new Request('https://example.com/admin/settings', {
    method: 'POST',
    headers: { Origin: 'https://example.com', 'Sec-Fetch-Site': 'cross-site' },
  })
  assert.equal(isSafeAdminMutationRequest(request), false)
})

test('rejects mismatched origin even with same-origin fetch metadata', () => {
  const request = new Request('https://example.com/admin/settings', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'same-origin' },
  })
  assert.equal(isSafeAdminMutationRequest(request), false)
})

test('rejects scheme mismatch for an otherwise identical host', () => {
  const request = new Request('https://example.com/admin/settings', {
    method: 'POST',
    headers: { Origin: 'http://example.com', 'Sec-Fetch-Site': 'same-origin' },
  })
  assert.equal(isSafeAdminMutationRequest(request), false)
})

test('does not block safe methods or non-admin paths', () => {
  assert.equal(isSafeAdminMutationRequest(new Request('https://example.com/contact', { method: 'POST' })), true)
  assert.equal(isSafeAdminMutationRequest(new Request('https://example.com/admin/login', { method: 'GET' })), true)
})

test('rejects cross-origin contact form posts', () => {
  const request = new Request('https://example.com/contact', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
  })
  assert.equal(isSafeAdminMutationRequest(request), false)
})

// ---- CSRF 中间件接线(严格模式) ----
// 变更请求必须回传与 cookie 一致的 token:`X-CSRF-Token` 请求头或 `_csrf` 隐藏字段。
// 只带 cookie、或只靠同源来源头,都不再放行。

type Fetchable = { fetch: (request: Request) => Promise<Response> }

function buildAdminApp(): Hono {
  const app = new Hono()
  app.use('/admin/*', ensureCsrfCookie())
  app.use('/admin/*', csrfProtection())
  app.get('/admin/settings', (c) => c.html('<h1>panel</h1>'))
  app.post('/admin/settings', (c) => c.text('HANDLER-REACHED'))
  app.post('/admin/login', (c) => c.text('LOGIN-REACHED'))
  return app
}

const SAME_ORIGIN = { Origin: 'https://example.com', 'Sec-Fetch-Site': 'same-origin' }

/** 取一次后台 GET 响应里下发的 csrf_token,模拟浏览器先打开后台页面。 */
async function issueToken(app: Fetchable): Promise<string> {
  const get = await app.fetch(new Request('https://example.com/admin/settings'))
  const token = (get.headers.get('set-cookie') || '').match(/csrf_token=([^;]+)/)?.[1]
  assert.ok(token, 'GET 后台页面必须下发 csrf_token')
  return token
}

test('访问后台页面会下发 csrf_token cookie', async () => {
  const res = await buildAdminApp().fetch(new Request('https://example.com/admin/settings'))
  const setCookie = res.headers.get('set-cookie') || ''
  assert.ok(setCookie.includes('csrf_token='), 'GET 后台页面必须下发 csrf_token')
  assert.ok(/SameSite=Lax/i.test(setCookie), 'csrf_token 必须是 SameSite=Lax')
  // 双提交的前提是客户端能把同一个值再回传一次,所以不能是 HttpOnly。
  assert.ok(!/HttpOnly/i.test(setCookie), 'csrf_token 不能是 HttpOnly,否则前端读不到 token 去填表单')
})

test('表单隐藏字段 _csrf 与 cookie 一致时放行', async () => {
  const app = buildAdminApp()
  const token = await issueToken(app)
  const res = await app.fetch(new Request('https://example.com/admin/settings', {
    method: 'POST',
    headers: {
      cookie: 'csrf_token=' + token,
      'content-type': 'application/x-www-form-urlencoded',
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({ _csrf: token, site_name: 'demo' }).toString(),
  }))
  assert.equal(res.status, 200, '带正确 _csrf 的同源表单必须放行')
  assert.equal(await res.text(), 'HANDLER-REACHED')
})

test('X-CSRF-Token 请求头与 cookie 一致时放行(fetch 路径)', async () => {
  const app = buildAdminApp()
  const token = await issueToken(app)
  const res = await app.fetch(new Request('https://example.com/admin/settings', {
    method: 'POST',
    headers: { cookie: 'csrf_token=' + token, 'X-CSRF-Token': token, ...SAME_ORIGIN },
  }))
  assert.equal(res.status, 200)
  assert.equal(await res.text(), 'HANDLER-REACHED')
})

test('中间件校验请求体后,处理器仍能读到表单字段(体缓存)', async () => {
  const app = new Hono()
  app.use('/admin/*', ensureCsrfCookie())
  app.use('/admin/*', csrfProtection())
  app.post('/admin/settings', async (c) => {
    const form = await c.req.parseBody()
    return c.text('GOT:' + String(form.site_name || ''))
  })
  const token = await issueToken(app)
  const res = await app.fetch(new Request('https://example.com/admin/settings', {
    method: 'POST',
    headers: {
      cookie: 'csrf_token=' + token,
      'content-type': 'application/x-www-form-urlencoded',
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({ _csrf: token, site_name: 'demo' }).toString(),
  }))
  assert.equal(res.status, 200)
  assert.equal(await res.text(), 'GOT:demo', '中间件读过请求体后处理器不能读到空体')
})

test('只带 cookie、不带 token 的同源提交被拒绝', async () => {
  const app = buildAdminApp()
  const token = await issueToken(app)
  const res = await app.fetch(new Request('https://example.com/admin/settings', {
    method: 'POST',
    headers: { cookie: 'csrf_token=' + token, ...SAME_ORIGIN },
  }))
  assert.equal(res.status, 403, '没有 token 不能再靠同源来源头放行')
})

test('token 与 cookie 不一致时被拒绝', async () => {
  const app = buildAdminApp()
  const token = await issueToken(app)
  const res = await app.fetch(new Request('https://example.com/admin/settings', {
    method: 'POST',
    headers: { cookie: 'csrf_token=' + token, 'X-CSRF-Token': 'f'.repeat(token.length), ...SAME_ORIGIN },
  }))
  assert.equal(res.status, 403)
})

test('跨站提交即使携带正确 token 也被拒绝(来源门)', async () => {
  const app = buildAdminApp()
  const token = await issueToken(app)
  const res = await app.fetch(new Request('https://example.com/admin/settings', {
    method: 'POST',
    headers: {
      cookie: 'csrf_token=' + token,
      'X-CSRF-Token': token,
      Origin: 'https://evil.example',
      'Sec-Fetch-Site': 'cross-site',
    },
  }))
  assert.equal(res.status, 403)
})

test('缺少 csrf cookie 的后台提交被拒绝', async () => {
  const res = await buildAdminApp().fetch(new Request('https://example.com/admin/settings', {
    method: 'POST',
    headers: { ...SAME_ORIGIN },
  }))
  assert.equal(res.status, 403)
})

test('登录路由豁免 CSRF 校验', async () => {
  const res = await buildAdminApp().fetch(new Request('https://example.com/admin/login', {
    method: 'POST',
    headers: { Origin: 'https://example.com' },
  }))
  assert.equal(res.status, 200)
  assert.equal(await res.text(), 'LOGIN-REACHED')
})
