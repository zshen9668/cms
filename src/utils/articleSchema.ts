export type ArticleFaqItem = { q: string; a: string }

export function parseArticleFaq(raw: unknown, max = 8): ArticleFaqItem[] {
  let list: unknown = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return []
    try {
      list = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  const items: ArticleFaqItem[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const q = String(r.q ?? r.question ?? '').trim()
    const a = String(r.a ?? r.answer ?? '').trim()
    if (!q || !a) continue
    items.push({ q: q.slice(0, 200), a: a.slice(0, 1000) })
    if (items.length >= max) break
  }
  return items
}

export function faqPageJsonLd(items: ArticleFaqItem[]): Record<string, unknown> | null {
  if (!items.length) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a.slice(0, 400) },
    })),
  }
}

function toStringValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

/**
 * 从后台文章表单提交体里构造 faq_json。
 *
 * 为什么字段名带索引（faq_q_0 / faq_a_0）而不是重复的 faq_q：
 * Hono 的 `c.req.parseBody()` 默认对重复键**只保留最后一个值**，
 * 用同名重复字段提交多组问答时，前面几组会被静默丢掉（只剩最后一组）。
 * 改用索引名后每组都是独立键，配对关系也不会错位。
 *
 * 索引允许有空洞（用户删掉中间某组后剩下的索引不连续），所以这里是遍历而非收集。
 * 问题或答案任一为空的那一组直接丢弃——结构化数据里出现空答案会被判为标记错误。
 */
export function buildFaqJsonFromBody(body: Record<string, unknown>, maxSlots = 16, max = 8): string {
  const pairs: ArticleFaqItem[] = []
  for (let i = 0; i < maxSlots && pairs.length < max; i++) {
    const q = toStringValue(body[`faq_q_${i}`]).trim()
    const a = toStringValue(body[`faq_a_${i}`]).trim()
    if (!q || !a) continue
    pairs.push({ q: q.slice(0, 200), a: a.slice(0, 1000) })
  }
  return pairs.length ? JSON.stringify(pairs) : ''
}

/** 表单是否来自带 FAQ 编辑器的文章表单。用它区分「清空问答」和「这个入口根本没有 FAQ 字段」。 */
export function hasFaqEditorFields(body: Record<string, unknown>): boolean {
  return String(body.faq_editor || '') === '1'
}
