/**
 * 编码错乱（乱码）识别。
 *
 * 后台的页面标签、站点名称等文本来自 D1。如果这些值是在编码不一致的环境里写入的
 * （例如从 GBK 终端粘贴、或经非 UTF-8 中间层转发），存进去的就是「UTF-8 字节被按
 * GBK/Latin-1 解码」的结果，前台/后台读出来就是乱码。
 *
 * 这里不做自动修复（错误解码不可逆），只做识别：调用方发现是乱码时回退到内置默认值，
 * 避免把乱码直接显示给站长。站长在编辑页重新填写即可覆盖。
 */

/** 是否包含中日韩统一表意文字。 */
function hasCjk(text: string): boolean {
  return /[㐀-䶿一-鿿豈-﫿]/.test(text)
}

/**
 * 乱码特征字符：Latin-1 补充、拉丁扩展、希腊、西里尔、字母式符号、CJK 兼容形式。
 *
 * 刻意不含 U+2000–U+206F（弯引号、破折号）与 U+FF00–U+FFEF（全角标点）——
 * 这两段在正常中文里天天出现，收进来会把「首页，服务」这种正常文本误判成乱码。
 */
const ODD_CHARS = /[ -ɏʰ-˿Ͱ-ϿЀ-ӿ℀-⇿︰-﹏]/g

/**
 * 判断一段文本是否像被错误解码的中文。
 *
 * 判定规则（保守，宁可漏判也不误判正常文本）：
 * - 含 U+FFFD 替换字符 → 一定是解码失败；
 * - 含中文，同时又混入乱码特征字符 → 判定为乱码。
 *   正常中文标签不会混进西里尔/希腊/拉丁扩展字符，而 UTF-8 中文按 GBK 解码后
 *   常常是「一个像样的汉字 + 几个怪字符」（例如「首页」→「棣?ҳ」），
 *   所以不能只看"有没有汉字"。
 * - 不含中文时，乱码特征字符占比超过 40% 才判定为乱码，避免把 Café 这类正常外文误伤。
 */
export function looksLikeMojibake(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (!text) return false
  if (text.includes('�')) return true
  const compact = text.replace(/\s+/g, '')
  if (!compact) return false
  const odd = compact.match(ODD_CHARS)
  if (!odd) return false
  if (hasCjk(compact)) return true
  return odd.length >= Math.max(2, Math.ceil(compact.length * 0.4))
}

/** 文本是乱码时回退到 fallback，否则原样返回。 */
export function preferReadable(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim()
  if (!text || looksLikeMojibake(text)) return fallback
  return text
}
