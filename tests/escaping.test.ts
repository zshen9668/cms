import test from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml, serializeJsonLd } from '../src/templates/layout.ts'
import { sanitizeAiPublicHtml } from '../src/templates/public.ts'
import { getCookie } from '../src/utils/auth.ts'

// 这些用例针对曾真实出现的漏洞：转义函数被写成空操作后，全部 250+ 处调用点静默失效，
// 而原有测试套件没有任何用例覆盖转义输出本身。

test('escapeHtml 转义 HTML 元字符，而不是原样返回', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')
  assert.equal(escapeHtml('" onmouseover="alert(1)'), '&quot; onmouseover=&quot;alert(1)')
  assert.equal(escapeHtml("'; alert(1); //"), '&#39;; alert(1); //')
  assert.equal(escapeHtml('&'), '&amp;')
})

test('escapeHtml 对 undefined/null 返回空串', () => {
  assert.equal(escapeHtml(undefined), '')
  assert.equal(escapeHtml(null as unknown as string), '')
})

test('escapeHtml 输出可安全嵌入标签体与属性值', () => {
  const hostile = '<img src=x onerror="alert(1)">'
  const out = escapeHtml(hostile)
  assert.ok(!out.includes('<'), '输出不得残留 <')
  assert.ok(!out.includes('>'), '输出不得残留 >')
  assert.ok(!out.includes('"'), '输出不得残留裸双引号')
})

test('serializeJsonLd 阻止 </script> 闭合脚本块', () => {
  const out = serializeJsonLd({ headline: '</script><img src=x onerror=alert(1)>' })
  assert.ok(!out.includes('</script>'), '不得出现裸 </script>')
  assert.ok(!out.includes('<'), '不得出现裸 <')
  assert.ok(out.includes('\\u003c'), '应以 \\u003c 形式转义')
})

test('serializeJsonLd 转义 & 与 U+2028/U+2029 且保持 JSON 可解析', () => {
  const value = { a: 'x&y', b: 'line' + String.fromCharCode(0x2028) + 'sep' }
  const out = serializeJsonLd(value)
  assert.ok(!/[^\\]&/.test(out) || out.includes('\\u0026'), '& 应被转义')
  assert.ok(!out.includes(String.fromCharCode(0x2028)), 'U+2028 应被转义')
  assert.deepEqual(JSON.parse(out), value, '转义后仍是合法 JSON 且语义不变')
})

test('sanitizeAiPublicHtml 丢弃未闭合的标签残片', () => {
  // 主正则要求标签以 > 闭合；这类残片曾原样输出，浏览器会与后续模板标签拼接后执行。
  assert.equal(sanitizeAiPublicHtml('<img src=x onerror=alert(1)'), '')
  assert.equal(sanitizeAiPublicHtml('<svg onload=alert(1)'), '')
  assert.equal(sanitizeAiPublicHtml('<p>正常</p><img src=x onerror=alert(1)'), '<p>正常</p>')
})

test('sanitizeAiPublicHtml 剥离属性并移除危险标签', () => {
  assert.ok(!sanitizeAiPublicHtml('<a href="javascript:alert(1)">x</a>').includes('href'))
  assert.equal(sanitizeAiPublicHtml('<script>alert(1)</script>'), '')
  assert.ok(!sanitizeAiPublicHtml('<img src=x onerror=alert(1)>').includes('onerror'))
})

test('sanitizeAiPublicHtml 保留白名单排版标签', () => {
  assert.equal(sanitizeAiPublicHtml('<p>段落</p><strong>粗</strong>'), '<p>段落</p><strong>粗</strong>')
})

test('getCookie 对畸形百分号编码不抛异常', () => {
  // 该函数在鉴权/CSRF 中间件的 try 之外被调用，抛错会让整个请求 500。
  const req = new Request('https://example.com/admin', { headers: { cookie: 'admin_session=%' } })
  assert.doesNotThrow(() => getCookie(req, 'admin_session'))
  assert.equal(getCookie(req, 'admin_session'), '%')
})

test('getCookie 正常解码合法 cookie', () => {
  const req = new Request('https://example.com/admin', { headers: { cookie: 'a=1; admin_session=abc%20def' } })
  assert.equal(getCookie(req, 'admin_session'), 'abc def')
  assert.equal(getCookie(req, 'missing'), undefined)
})
