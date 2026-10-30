import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  aes256CbcDecrypt, aes256CbcEncrypt, buildWecomTextReply, decodeAesKey,
  decryptWecomMessage, encryptWecomMessage, parseWecomMessage, verifyWecomSignature,
} from '../src/utils/wecomWork.ts'

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(value: string): Uint8Array {
  const bin = atob(value)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const utf8 = (value: string) => new TextEncoder().encode(value)
const fromUtf8 = (value: Uint8Array) => new TextDecoder().decode(value)

// ---------------------------------------------------------------------------
// AES-256-CBC 正确性：NIST SP 800-38A F.2.5 / F.2.6 标准测试向量
//
// 自己实现 AES 的风险在于「错一位、半数消息解密失败」，生产上极难定位，
// 因此必须用权威向量锁死，而不是只做自洽的加解密往返。
// ---------------------------------------------------------------------------
const NIST_KEY = fromHex('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4')
const NIST_IV = fromHex('000102030405060708090a0b0c0d0e0f')
const NIST_PLAIN = fromHex(
  '6bc1bee22e409f96e93d7e117393172a' +
  'ae2d8a571e03ac9c9eb76fac45af8e51' +
  '30c81c46a35ce411e5fbc1191a0a52ef' +
  'f69f2445df4f9b17ad2b417be66c3710',
)
const NIST_CIPHER = fromHex(
  'f58c4c04d6e5f1ba779eabfb5f7bfbd6' +
  '9cfc4e967edb808d679f777bc6702c7d' +
  '39f23369a9d9bacfa530e26304231461' +
  'b2eb05e2c39be9fcda6c19078c6a9d1b',
)

test('aes256CbcEncrypt matches the NIST SP 800-38A CBC-AES256 vector', () => {
  assert.equal(toHex(aes256CbcEncrypt(NIST_KEY, NIST_IV, NIST_PLAIN)), toHex(NIST_CIPHER))
})

test('aes256CbcDecrypt matches the NIST SP 800-38A CBC-AES256 vector', () => {
  assert.equal(toHex(aes256CbcDecrypt(NIST_KEY, NIST_IV, NIST_CIPHER)), toHex(NIST_PLAIN))
})

test('aes256CbcDecrypt inverts aes256CbcEncrypt for multi-block payloads', () => {
  const data = utf8('白标 CMS 企业微信回调：多块数据加解密往返验证，含中文与 emoji 🚀')
  const padded = new Uint8Array(Math.ceil(data.length / 16) * 16)
  padded.set(data)
  const cipher = aes256CbcEncrypt(NIST_KEY, NIST_IV, padded)
  assert.equal(fromUtf8(aes256CbcDecrypt(NIST_KEY, NIST_IV, cipher).slice(0, data.length)), fromUtf8(data))
})

// ---------------------------------------------------------------------------
// EncodingAESKey：43 位 Base64 字符串 → 32 字节密钥
// ---------------------------------------------------------------------------
function makeAesKey(): string {
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = (i * 7 + 3) & 0xff
  return toBase64(bytes).replace(/=+$/, '')
}

test('decodeAesKey accepts a 43-character key and rejects anything else', () => {
  const aesKey = makeAesKey()
  assert.equal(aesKey.length, 43)
  assert.equal(decodeAesKey(aesKey).length, 32)
  assert.throws(() => decodeAesKey(aesKey.slice(0, 42)), /43 位/)
  assert.throws(() => decodeAesKey(aesKey + 'X'), /43 位/)
})

// ---------------------------------------------------------------------------
// 企业微信消息加解密
// ---------------------------------------------------------------------------

test('encryptWecomMessage / decryptWecomMessage round-trip across every padding length', () => {
  const aesKey = makeAesKey()
  const corpId = 'ww1234567890abcdef'
  // 遍历 20..52 字节的消息长度：PKCS#7 块长为 32，填充长度会在 1..32 之间完整覆盖。
  // 填充 17..32 字节正是 WebCrypto 的 AES-CBC 会直接抛错的区间，
  // 也是必须自带 AES 实现的原因。
  for (let length = 1; length <= 40; length++) {
    const message = 'Q'.repeat(length)
    const encrypted = encryptWecomMessage(aesKey, message, corpId)
    assert.equal(decryptWecomMessage(aesKey, encrypted, corpId), message, '长度 ' + length + ' 往返失败')
  }
})

test('decryptWecomMessage reads the body by explicit length, like the official algorithm', () => {
  const aesKey = makeAesKey()
  const corpId = 'ww1234567890abcdef'
  const message = '<xml><Content><![CDATA[你们能提供哪些服务？]]></Content></xml>'
  const encrypted = encryptWecomMessage(aesKey, message, corpId)
  assert.equal(decryptWecomMessage(aesKey, encrypted, corpId), message)
})

test('decryptWecomMessage rejects a ciphertext belonging to another CorpID', () => {
  const aesKey = makeAesKey()
  const encrypted = encryptWecomMessage(aesKey, 'hello', 'ww-other-corp')
  assert.throws(() => decryptWecomMessage(aesKey, encrypted, 'ww-my-corp'), /CorpID/)
  // 不校验 CorpID 时必须能解出来（否则上面的失败可能来自解密本身）
  assert.equal(decryptWecomMessage(aesKey, encrypted, ''), 'hello')
})

test('decryptWecomMessage accepts ciphertext produced by an independent AES-CBC implementation', () => {
  // 用 WebCrypto（Node 自带）按企业微信的结构加密，验证我们自研的 AES 解密实现
  // 得到的是同一份明文——自洽的往返回路测不出 AES 的错误。
  const aesKey = makeAesKey()
  const corpId = 'ww1234567890abcdef'
  const message = '独立实现交叉验证：这句话必须能被原样解出来。'
  const body = new Uint8Array(16 + 4 + utf8(message).length + corpId.length)
  body.set(new Uint8Array(16).fill(0xab), 0)
  new DataView(body.buffer).setUint32(16, utf8(message).length, false)
  body.set(utf8(message), 20)
  body.set(utf8(corpId), 20 + utf8(message).length)
  const n = 32 - (body.length % 32) || 32
  const padded = new Uint8Array(body.length + n)
  padded.set(body, 0)
  padded.fill(n, body.length)

  return crypto.subtle
    .importKey('raw', decodeAesKey(aesKey), 'AES-CBC', false, ['encrypt'])
    .then((key) => crypto.subtle.encrypt({ name: 'AES-CBC', iv: decodeAesKey(aesKey).slice(0, 16) }, key, padded))
    .then((buffer) => {
      const encrypted = toBase64(new Uint8Array(buffer))
      assert.equal(decryptWecomMessage(aesKey, encrypted, corpId), message)
    })
})

test('decryptWecomMessage rejects malformed ciphertext instead of returning garbage', () => {
  const aesKey = makeAesKey()
  assert.throws(() => decryptWecomMessage(aesKey, '', ''), /密文长度非法/)
  assert.throws(() => decryptWecomMessage(aesKey, toBase64(new Uint8Array(16)), ''))
})

// ---------------------------------------------------------------------------
// 签名校验：与企业微信文档 SHA1(sort(token, timestamp, nonce, encrypt)) 一致
// ---------------------------------------------------------------------------

function expectedSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  // 用 Node 自带的 crypto 独立算一遍，避免"实现和测试用同一段代码"的假绿。
  return createHash('sha1').update([token, timestamp, nonce, encrypt].sort().join('')).digest('hex')
}

test('verifyWecomSignature accepts the official digest and rejects tampering', async () => {
  const token = 'myToken123'
  const timestamp = '1700000000'
  const nonce = 'abcdefg'
  const encrypt = 'U2FsdGVkX1+abcdefghijklmn=='

  assert.equal(await verifyWecomSignature(token, timestamp, nonce, encrypt, expectedSignature(token, timestamp, nonce, encrypt)), true)
  // 大小写不敏感（企业微信有时会传大写）
  assert.equal(await verifyWecomSignature(token, timestamp, nonce, encrypt, expectedSignature(token, timestamp, nonce, encrypt).toUpperCase()), true)
  assert.equal(await verifyWecomSignature(token, timestamp, nonce, encrypt + 'x', expectedSignature(token, timestamp, nonce, encrypt)), false)
  assert.equal(await verifyWecomSignature('wrong', timestamp, nonce, encrypt, expectedSignature(token, timestamp, nonce, encrypt)), false)
  assert.equal(await verifyWecomSignature(token, timestamp, nonce, encrypt, ''), false)
  assert.equal(await verifyWecomSignature('', timestamp, nonce, encrypt, expectedSignature(token, timestamp, nonce, encrypt)), false)
})

// ---------------------------------------------------------------------------
// XML 解析与构造
// ---------------------------------------------------------------------------

test('parseWecomMessage reads CDATA and plain fields', () => {
  const xml = '<xml><ToUserName><![CDATA[ww123]]></ToUserName>' +
    '<FromUserName><![CDATA[zhangsan]]></FromUserName>' +
    '<CreateTime>1700000000</CreateTime>' +
    '<MsgType><![CDATA[text]]></MsgType>' +
    '<Content><![CDATA[你们在深圳有服务吗？]]></Content>' +
    '<MsgId>1234567890</MsgId>' +
    '<AgentID>1000002</AgentID></xml>'
  const parsed = parseWecomMessage(xml)
  assert.equal(parsed.toUser, 'ww123')
  assert.equal(parsed.fromUser, 'zhangsan')
  assert.equal(parsed.msgType, 'text')
  assert.equal(parsed.content, '你们在深圳有服务吗？')
  assert.equal(parsed.msgId, '1234567890')
  assert.equal(parsed.agentId, '1000002')
  assert.equal(parsed.event, '')
})

test('parseWecomMessage handles event messages and missing fields', () => {
  const parsed = parseWecomMessage('<xml><FromUserName><![CDATA[lisi]]></FromUserName><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[subscribe]]></Event></xml>')
  assert.equal(parsed.msgType, 'event')
  assert.equal(parsed.event, 'subscribe')
  assert.equal(parsed.content, '')
  assert.equal(parsed.msgId, '')
})

test('buildWecomTextReply escapes CDATA terminators so the XML cannot be truncated', () => {
  const content = '危险内容 ]]> 后面的字必须还在'
  const xml = buildWecomTextReply({
    toUser: 'zhangsan',
    fromUser: 'ww123',
    content,
    timestamp: 1700000000000,
  })
  assert.ok(xml.includes('<CreateTime>1700000000</CreateTime>'))
  // ]]> 必须被拆成 ]]]]><![CDATA[>，否则企业微信会在该处提前结束 CDATA 段，
  // 内容被截断、后续标签变成非法 XML。
  const rawContent = /<Content>([\s\S]*)<\/Content>/.exec(xml)?.[1] || ''
  assert.ok(rawContent.includes(']]]]><![CDATA[>'), '应把 ]]> 拆成 ]]]]><![CDATA[>')
  // 用最小 CDATA 解析器还原：拼接后的内容必须与原文逐字相同
  let decoded = ''
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+)/g
  let match
  while ((match = re.exec(rawContent))) decoded += match[1] ?? match[2] ?? ''
  assert.equal(decoded, content)
})

test('decryptWecomMessage / encryptWecomMessage survive a base64 transcode of the envelope', () => {
  const aesKey = makeAesKey()
  const corpId = 'ww123'
  const encrypted = encryptWecomMessage(aesKey, 'ABC', corpId)
  // 真实回调是 XML 包裹的 base64，这里模拟一次「拆包 → 再拼回」
  const wrapped = '<xml><Encrypt><![CDATA[' + encrypted + ']]></Encrypt></xml>'
  const extracted = /<Encrypt>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/Encrypt>/.exec(wrapped)?.[1]
  assert.ok(extracted)
  assert.equal(decryptWecomMessage(aesKey, extracted!, corpId), 'ABC')
  assert.deepEqual(Array.from(fromBase64(extracted!)), Array.from(fromBase64(encrypted)))
})
