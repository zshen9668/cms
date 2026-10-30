/**
 * 企业微信（WeCom）接入工具。
 *
 * 背景：系统密钥页早已登记 CorpID / AgentId / Secret / Token / EncodingAESKey 五项，
 * 但没有落地代码——密钥填了完全不起作用。本文件补齐「回调校验 + 消息解密 +
 * 被动回复加密 + 主动发送」四件事。
 *
 * 为什么自带 AES 而不走 WebCrypto：
 *   企业微信的 AES-256-CBC 要求 **PKCS#7 填充块长为 32 字节**，
 *   而 WebCrypto 的 AES-CBC 固定按 16 字节块校验/剥离填充。
 *   当填充长度为 17~32 字节时（真实流量里约一半的消息），
 *   crypto.subtle.decrypt 会直接抛 OperationError。
 *   因此这里实现纯 TS 的 AES-256 加解密（零依赖、可在 Node 单测里直接验证）。
 *
 * 安全性：密钥只从 systemSecrets 读取（AES-GCM 加密存 settings 表 / 环境变量兜底），
 * 从不写入日志；签名比对使用常量时间比较。
 */
import type { Bindings } from '../types'
import { getSystemSecret } from './systemSecrets'
import { safeWarn } from './safeLogger'

// ===========================================================================
// 配置读取
// ===========================================================================

export type WecomConfig = {
  corpId: string
  agentId: string
  secret: string
  token: string
  aesKey: string
}

/** 读企业微信配置；任一项缺失返回 null（调用方按"未接入"处理，不报错）。 */
export async function getWecomConfig(env: Pick<Bindings, 'DB' | 'CACHE_KV'>): Promise<WecomConfig | null> {
  const [corpId, agentId, secret, token, aesKey] = await Promise.all([
    getSystemSecret(env, 'WECHAT_WORK_CORP_ID'),
    getSystemSecret(env, 'WECHAT_WORK_AGENT_ID'),
    getSystemSecret(env, 'WECHAT_WORK_SECRET'),
    getSystemSecret(env, 'WECHAT_WORK_TOKEN'),
    getSystemSecret(env, 'WECHAT_WORK_AES_KEY'),
  ])
  if (!corpId || !secret) return null
  return { corpId, agentId, secret, token, aesKey }
}

/** 回调（接收消息）需要的三项：Token、EncodingAESKey、CorpID。缺一不可。 */
export function hasWecomCallbackConfig(config: WecomConfig | null): config is WecomConfig {
  return Boolean(config && config.token && config.aesKey && config.corpId)
}

// ===========================================================================
// AES-256-CBC（PKCS#7，块长 32）
// ===========================================================================

const SBOX = (() => {
  const sbox = new Uint8Array(256)
  const inv = new Uint8Array(256)
  const mul = (a: number, b: number): number => {
    let p = 0
    for (let i = 0; i < 8; i++) {
      if (b & 1) p ^= a
      const hi = a & 0x80
      a = (a << 1) & 0xff
      if (hi) a ^= 0x1b
      b >>= 1
    }
    return p
  }
  const pow = (a: number, n: number): number => {
    let r = 1
    for (let i = 0; i < n; i++) r = mul(r, a)
    return r
  }
  for (let i = 1; i < 256; i++) inv[i] = pow(i, 254)
  for (let i = 0; i < 256; i++) {
    const x = inv[i]!
    let y = x
    let s = x
    for (let k = 0; k < 4; k++) {
      y = ((y << 1) | (y >>> 7)) & 0xff
      s ^= y
    }
    sbox[i] = s ^ 0x63
  }
  return sbox
})()

const INV_SBOX = (() => {
  const out = new Uint8Array(256)
  for (let i = 0; i < 256; i++) out[SBOX[i]!] = i
  return out
})()

const gmul = (a: number, b: number): number => {
  let p = 0
  let x = a
  let y = b
  for (let i = 0; i < 8; i++) {
    if (y & 1) p ^= x
    const hi = x & 0x80
    x = (x << 1) & 0xff
    if (hi) x ^= 0x1b
    y >>= 1
  }
  return p
}

const gmul2 = (a: number): number => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff
const gmul3 = (a: number): number => gmul2(a) ^ a

function expandKey(key: Uint8Array): Uint8Array[] {
  const nk = key.length / 4
  const nr = nk + 6
  const words: Uint8Array[] = []
  for (let i = 0; i < nk; i++) words.push(key.slice(i * 4, i * 4 + 4))
  let rcon = 1
  for (let i = nk; i < 4 * (nr + 1); i++) {
    let temp = words[i - 1]!.slice()
    if (i % nk === 0) {
      temp = new Uint8Array([SBOX[temp[1]!]!, SBOX[temp[2]!]!, SBOX[temp[3]!]!, SBOX[temp[0]!]!])
      temp[0] = temp[0]! ^ rcon
      rcon = gmul2(rcon)
    } else if (nk > 6 && i % nk === 4) {
      temp = new Uint8Array([SBOX[temp[0]!]!, SBOX[temp[1]!]!, SBOX[temp[2]!]!, SBOX[temp[3]!]!])
    }
    const prev = words[i - nk]!
    words.push(new Uint8Array([
      prev[0]! ^ temp[0]!, prev[1]! ^ temp[1]!, prev[2]! ^ temp[2]!, prev[3]! ^ temp[3]!,
    ]))
  }
  const roundKeys: Uint8Array[] = []
  for (let r = 0; r <= nr; r++) {
    const rk = new Uint8Array(16)
    for (let c = 0; c < 4; c++) {
      const w = words[r * 4 + c]!
      rk[c * 4] = w[0]!
      rk[c * 4 + 1] = w[1]!
      rk[c * 4 + 2] = w[2]!
      rk[c * 4 + 3] = w[3]!
    }
    roundKeys.push(rk)
  }
  return roundKeys
}

// 状态按列主序存放：下标 = 列 * 4 + 行
function addRoundKey(state: Uint8Array, rk: Uint8Array): void {
  for (let i = 0; i < 16; i++) state[i] = state[i]! ^ rk[i]!
}

function subBytes(state: Uint8Array): void {
  for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]!]!
}

function invSubBytes(state: Uint8Array): void {
  for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]!]!
}

function shiftRows(state: Uint8Array): void {
  let t = state[1]!
  state[1] = state[5]!
  state[5] = state[9]!
  state[9] = state[13]!
  state[13] = t
  const t2 = state[2]!
  const t3 = state[6]!
  state[2] = state[10]!
  state[6] = state[14]!
  state[10] = t2
  state[14] = t3
  t = state[15]!
  state[15] = state[11]!
  state[11] = state[7]!
  state[7] = state[3]!
  state[3] = t
}

function invShiftRows(state: Uint8Array): void {
  let t = state[13]!
  state[13] = state[9]!
  state[9] = state[5]!
  state[5] = state[1]!
  state[1] = t
  const t2 = state[2]!
  const t3 = state[6]!
  state[2] = state[10]!
  state[6] = state[14]!
  state[10] = t2
  state[14] = t3
  t = state[3]!
  state[3] = state[7]!
  state[7] = state[11]!
  state[11] = state[15]!
  state[15] = t
}

function mixColumns(state: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const i = c * 4
    const a0 = state[i]!
    const a1 = state[i + 1]!
    const a2 = state[i + 2]!
    const a3 = state[i + 3]!
    state[i] = gmul2(a0) ^ gmul3(a1) ^ a2 ^ a3
    state[i + 1] = a0 ^ gmul2(a1) ^ gmul3(a2) ^ a3
    state[i + 2] = a0 ^ a1 ^ gmul2(a2) ^ gmul3(a3)
    state[i + 3] = gmul3(a0) ^ a1 ^ a2 ^ gmul2(a3)
  }
}

function invMixColumns(state: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const i = c * 4
    const a0 = state[i]!
    const a1 = state[i + 1]!
    const a2 = state[i + 2]!
    const a3 = state[i + 3]!
    state[i] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9)
    state[i + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13)
    state[i + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11)
    state[i + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14)
  }
}

function encryptBlock(roundKeys: Uint8Array[], block: Uint8Array): Uint8Array {
  const nr = roundKeys.length - 1
  const state = block.slice()
  addRoundKey(state, roundKeys[0]!)
  for (let r = 1; r < nr; r++) {
    subBytes(state)
    shiftRows(state)
    mixColumns(state)
    addRoundKey(state, roundKeys[r]!)
  }
  subBytes(state)
  shiftRows(state)
  addRoundKey(state, roundKeys[nr]!)
  return state
}

function decryptBlock(roundKeys: Uint8Array[], block: Uint8Array): Uint8Array {
  const nr = roundKeys.length - 1
  const state = block.slice()
  addRoundKey(state, roundKeys[nr]!)
  for (let r = nr - 1; r >= 1; r--) {
    invShiftRows(state)
    invSubBytes(state)
    addRoundKey(state, roundKeys[r]!)
    invMixColumns(state)
  }
  invShiftRows(state)
  invSubBytes(state)
  addRoundKey(state, roundKeys[0]!)
  return state
}

/** 企业微信 PKCS#7 填充块长固定为 32。 */
const PKCS7_BLOCK = 32

function pkcs7Pad(data: Uint8Array): Uint8Array {
  const n = PKCS7_BLOCK - (data.length % PKCS7_BLOCK) || PKCS7_BLOCK
  const out = new Uint8Array(data.length + n)
  out.set(data, 0)
  out.fill(n, data.length)
  return out
}

function pkcs7Unpad(data: Uint8Array): Uint8Array {
  if (!data.length) return data
  const n = data[data.length - 1]!
  if (n < 1 || n > PKCS7_BLOCK || n > data.length) {
    throw new Error('企业微信消息填充非法，可能是 EncodingAESKey 不匹配')
  }
  return data.slice(0, data.length - n)
}

/**
 * AES-256-CBC 原语（不含填充）。
 *
 * 单独导出是为了让单元测试用 NIST SP 800-38A 的标准测试向量验证实现正确性——
 * AES 实现错一个字节在真实流量里只会表现为"偶发解密失败"，很难在生产上定位。
 */
export function aes256CbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const roundKeys = expandKey(key)
  const out = new Uint8Array(data.length)
  let prev: Uint8Array = iv.slice()
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = data.slice(offset, offset + 16)
    for (let i = 0; i < 16; i++) block[i] = block[i]! ^ prev[i]!
    const enc = encryptBlock(roundKeys, block)
    out.set(enc, offset)
    prev = enc
  }
  return out
}

export function aes256CbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const roundKeys = expandKey(key)
  const out = new Uint8Array(data.length)
  let prev: Uint8Array = iv.slice()
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = data.slice(offset, offset + 16)
    const dec = decryptBlock(roundKeys, block)
    for (let i = 0; i < 16; i++) out[offset + i] = dec[i]! ^ prev[i]!
    prev = block
  }
  return out
}

/** EncodingAESKey（43 位 Base64 字符）→ 32 字节 AES 密钥。 */
export function decodeAesKey(encodingAesKey: string): Uint8Array {
  const raw = String(encodingAesKey || '').trim()
  if (raw.length !== 43) throw new Error('企业微信 EncodingAESKey 必须是 43 位')
  const key = base64ToBytes(raw + '=')
  if (key.length !== 32) throw new Error('企业微信 EncodingAESKey 解码后必须是 32 字节')
  return key
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(String(value || ''))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const utf8Encode = (value: string): Uint8Array => new TextEncoder().encode(value)
const utf8Decode = (value: Uint8Array): string => new TextDecoder().decode(value)

// ===========================================================================
// 消息加解密
// ===========================================================================

/**
 * 解密企业微信回调密文。
 * 明文结构：16 字节随机数 + 4 字节大端消息长度 + 消息体 + CorpID。
 */
export function decryptWecomMessage(encodingAesKey: string, encrypted: string, expectedCorpId = ''): string {
  const key = decodeAesKey(encodingAesKey)
  const iv = key.slice(0, 16)
  const cipher = base64ToBytes(encrypted)
  if (!cipher.length || cipher.length % 16 !== 0) throw new Error('企业微信密文长度非法')
  const plain = pkcs7Unpad(aes256CbcDecrypt(key, iv, cipher))
  if (plain.length < 20) throw new Error('企业微信密文解密结果过短')

  const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength)
  const msgLength = view.getUint32(16, false)
  if (msgLength < 0 || 20 + msgLength > plain.length) throw new Error('企业微信密文消息长度非法')
  const message = utf8Decode(plain.slice(20, 20 + msgLength))
  let residue = plain.slice(20 + msgLength)
  // 兜底剥离残留填充：若有实现按 16 字节块追加了填充（WebCrypto 的 AES-CBC 就会），
  // 上面的 pkcs7Unpad 只按末尾字节剥了一次，receiveId 尾部仍会挂着这一层。
  // 真实企业微信密文不会有这层，此处是空操作；不剥的话 CorpID 比较会误判失败。
  // CorpID 是 ww + 十六进制字符，字节值必然 > 0x39，不可能被误认成填充。
  const residual = residue.length ? residue[residue.length - 1]! : 0
  if (residual >= 1 && residual <= PKCS7_BLOCK && residual < residue.length) {
    const tail = residue.slice(residue.length - residual)
    if (tail.every((byte) => byte === residual)) residue = residue.slice(0, residue.length - residual)
  }
  const receiveId = utf8Decode(residue)
  // CorpID 不匹配说明这条回调不是发给本站的（多套部署共用同一 Token 时会遇到），
  // 必须拒绝，否则会把别人的企业消息当成本站提问。
  if (expectedCorpId && receiveId && receiveId !== expectedCorpId) {
    throw new Error('企业微信回调 CorpID 不匹配')
  }
  return message
}

/** 加密被动回复内容（结构同上；填充块长 32）。 */
export function encryptWecomMessage(encodingAesKey: string, message: string, corpId: string, random16?: Uint8Array): string {
  const key = decodeAesKey(encodingAesKey)
  const iv = key.slice(0, 16)
  const msgBytes = utf8Encode(message)
  const receiveIdBytes = utf8Encode(corpId)
  const random = random16 && random16.length === 16 ? random16 : crypto.getRandomValues(new Uint8Array(16))
  const body = new Uint8Array(16 + 4 + msgBytes.length + receiveIdBytes.length)
  body.set(random, 0)
  new DataView(body.buffer).setUint32(16, msgBytes.length, false)
  body.set(msgBytes, 20)
  body.set(receiveIdBytes, 20 + msgBytes.length)
  const padded = pkcs7Pad(body)
  return bytesToBase64(aes256CbcEncrypt(key, iv, padded))
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 常量时间字符串比较，避免签名比对泄露时序信息。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

/**
 * 校验回调签名：SHA1(sort([token, timestamp, nonce, encrypt]).join(''))。
 * 官方文档要求四项字典序排序后拼接。
 */
export async function verifyWecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  signature: string,
): Promise<boolean> {
  if (!token || !signature) return false
  const sorted = [token, String(timestamp || ''), String(nonce || ''), String(encrypt || '')].sort().join('')
  const digest = await crypto.subtle.digest('SHA-1', utf8Encode(sorted))
  return timingSafeEqual(bytesToHex(new Uint8Array(digest)), String(signature).toLowerCase())
}

// ===========================================================================
// 消息解析 / 构造
// ===========================================================================

export type WecomIncomingMessage = {
  toUser: string
  fromUser: string
  createTime: string
  msgType: string
  content: string
  msgId: string
  agentId: string
  event: string
  eventKey: string
}

/** 取 XML 字段值：兼容 <Tag><![CDATA[x]]></Tag> 与 <Tag>x</Tag> 两种写法。 */
function xmlValue(xml: string, tag: string): string {
  const re = new RegExp('<' + tag + '>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</' + tag + '>', 'i')
  const match = re.exec(String(xml || ''))
  if (!match) return ''
  return String(match[1] ?? match[2] ?? '').trim().slice(0, 8000)
}

/**
 * 解析回调 XML。
 * 用正则而不是引入 XML 解析器：企业微信回调结构固定且扁平，
 * 引入依赖与「零依赖」原则冲突，而正则对这套扁平结构足够。
 */
export function parseWecomMessage(xml: string): WecomIncomingMessage {
  return {
    toUser: xmlValue(xml, 'ToUserName'),
    fromUser: xmlValue(xml, 'FromUserName'),
    createTime: xmlValue(xml, 'CreateTime'),
    msgType: (xmlValue(xml, 'MsgType') || 'text').toLowerCase(),
    content: xmlValue(xml, 'Content'),
    msgId: xmlValue(xml, 'MsgId'),
    agentId: xmlValue(xml, 'AgentID') || xmlValue(xml, 'AgentId'),
    event: (xmlValue(xml, 'Event') || '').toLowerCase(),
    eventKey: xmlValue(xml, 'EventKey'),
  }
}

/** CDATA 里不能出现 `]]>`，必须拆开，否则会截断 XML 并导致企业微信解析失败。 */
function cdata(value: string): string {
  return '<![CDATA[' + String(value ?? '').replace(/\]\]>/g, ']]]]><![CDATA[>') + ']]>'
}

export function buildWecomTextReply(params: {
  toUser: string
  fromUser: string
  content: string
  timestamp?: number
}): string {
  return '<xml>' +
    '<ToUserName>' + cdata(params.toUser) + '</ToUserName>' +
    '<FromUserName>' + cdata(params.fromUser) + '</FromUserName>' +
    '<CreateTime>' + Math.floor((params.timestamp ?? Date.now()) / 1000) + '</CreateTime>' +
    '<MsgType>' + cdata('text') + '</MsgType>' +
    '<Content>' + cdata(params.content) + '</Content>' +
    '</xml>'
}

/** 空串表示"收到，但不回复"——企业微信要求 5 秒内响应，超时会重推三次。 */
export function buildWecomEmptyReply(): string {
  return 'success'
}

// ===========================================================================
// 主动发送（access_token + message/send）
// ===========================================================================

type KvLike = { get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> }

/**
 * 获取并缓存接口调用凭证。
 * access_token 有效期 7200 秒且有调用频率限制（企业微信侧），
 * 必须缓存而不是每次请求都换：缓存 7000 秒，留 200 秒安全边界。
 */
export async function getWecomAccessToken(
  config: Pick<WecomConfig, 'corpId' | 'secret'>,
  kv?: KvLike,
): Promise<string> {
  const cacheKey = 'wecom:access_token:' + config.corpId
  if (kv) {
    try {
      const cached = await kv.get(cacheKey)
      if (cached) return cached
    } catch (e) {
      safeWarn('wecom access_token cache read failed', { error: String(e) })
    }
  }
  const res = await fetch(
    'https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=' + encodeURIComponent(config.corpId) +
    '&corpsecret=' + encodeURIComponent(config.secret),
    { signal: AbortSignal.timeout(8000) },
  )
  const data = await res.json() as any
  if (Number(data?.errcode || 0) !== 0 || !data?.access_token) {
    // errcode 40013 = CorpID 非法；40001/40014 = Secret 错误。不把 Secret 写进日志。
    throw new Error('企业微信 gettoken 失败：errcode=' + String(data?.errcode ?? '?') + ' ' + String(data?.errmsg || '').slice(0, 120))
  }
  const token = String(data.access_token)
  if (kv) {
    try {
      await kv.put(cacheKey, token, { expirationTtl: 7000 })
    } catch (e) {
      safeWarn('wecom access_token cache write failed', { error: String(e) })
    }
  }
  return token
}

/** 主动发文本消息给指定成员（企业微信 userid）。 */
export async function sendWecomTextMessage(
  env: Pick<Bindings, 'DB' | 'CACHE_KV'>,
  toUser: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const config = await getWecomConfig(env)
  if (!config || !config.agentId) return { ok: false, error: '企业微信未配置（缺少 CorpID / AgentId / Secret）' }
  const user = String(toUser || '').trim().slice(0, 200)
  const text = String(content || '').trim().slice(0, 2000)
  if (!user || !text) return { ok: false, error: '收件人或内容为空' }
  try {
    const accessToken = await getWecomAccessToken(config, env.CACHE_KV as unknown as KvLike)
    const res = await fetch('https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=' + encodeURIComponent(accessToken), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        touser: user,
        msgtype: 'text',
        agentid: Number(config.agentId) || config.agentId,
        text: { content: text },
        safe: 0,
      }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json() as any
    if (Number(data?.errcode || 0) !== 0) {
      return { ok: false, error: 'errcode=' + String(data?.errcode ?? '?') + ' ' + String(data?.errmsg || '').slice(0, 120) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e as any)?.message || e).slice(0, 200) }
  }
}
