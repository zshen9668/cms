export type SeoAuditPageType = 'home' | 'list' | 'article' | 'city' | 'service' | 'landing'

export type SeoAuditPage = {
  type: SeoAuditPageType
  key: string
  title: string
  url: string
  description: string
  content: string
  keywords: string
  indexable: boolean
  sitemap: boolean
  active?: boolean
  aiGenerated?: boolean
  opportunityScore?: number
  tenantId?: number // 数据归属租户，防止跨租户优化/删除
}

export type SeoAuditResult = {
  score: number
  indexable: boolean
  status: 'good' | 'optimize' | 'weak' | 'blocked'
  label: string
  reasons: string[]
  strengths: string[]
  metrics: {
    contentChars: number
    titleChars: number
    descriptionChars: number
    headings: number
    keywordCount: number
    keywordEvidence: number
  }
}

function stripHtml(value: string): string {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function keywordList(value: string): string[] {
  return Array.from(new Set(
    String(value || '')
      .split(/[,，;；、\n]+/)
      .map((v) => v.trim())
      .filter(Boolean),
  )).slice(0, 5)
}

function countHeadings(value: string): number {
  return (String(value || '').match(/<h[23]\b/gi) || []).length
}

function hasKeywordEvidence(keyword: string, text: string): boolean {
  const k = keyword.replace(/\s+/g, '').toLocaleLowerCase()
  const t = text.replace(/\s+/g, '').toLocaleLowerCase()
  return !!k && t.includes(k)
}

function isRedundantKeywordSet(keywords: string[]): boolean {
  const normalized = keywords.map((v) => v.replace(/\s+/g, '').toLocaleLowerCase())
  return normalized.some((word, i) =>
    normalized.some((other, j) => i !== j && other.length > word.length && other.includes(word)),
  )
}

export function auditSeoPage(page: SeoAuditPage): SeoAuditResult {
  const reasons: string[] = []
  const strengths: string[] = []
  const plain = stripHtml(page.content)
  const titleChars = page.title.replace(/\s+/g, '').length
  const descriptionChars = page.description.replace(/\s+/g, '').length
  const contentChars = plain.replace(/\s+/g, '').length
  const headings = countHeadings(page.content)
  const keywords = keywordList(page.keywords)
  const keywordEvidence = keywords.filter((k) => hasKeywordEvidence(k, page.title + ' ' + page.description + ' ' + plain)).length

  if (!page.indexable) {
    return {
      score: 10,
      indexable: false,
      status: 'blocked',
      label: '不可索引',
      reasons: ['页面当前不是公开可索引入口（隐藏、外站跳转或未达到公开条件）。'],
      strengths: [],
      metrics: { contentChars, titleChars, descriptionChars, headings, keywordCount: keywords.length, keywordEvidence },
    }
  }

  let score = 0
  const minimumContent = page.type === 'article'
    ? 650
    : page.type === 'city' || page.type === 'service' || page.type === 'landing'
      ? 560
      : page.key === 'contact'
        ? 180
        : 280

  if (page.sitemap) {
    score += 15
    strengths.push('有 Sitemap 入口')
  } else {
    reasons.push('当前没有进入 Sitemap，搜索引擎发现路径较弱。')
  }

  if (titleChars >= 8 && titleChars <= 45) {
    score += 12
    strengths.push('标题长度和主题表达基本合理')
  } else if (titleChars > 45) {
    score += 6
    reasons.push('标题偏长，建议围绕一个主搜索意图压缩。')
  } else {
    score += 4
    reasons.push('标题过短，主题信号不足。')
  }

  if (descriptionChars >= 50 && descriptionChars <= 180) {
    score += 10
    strengths.push('有完整页面描述')
  } else if (descriptionChars > 0) {
    score += 5
    reasons.push('页面描述过短或偏长，建议控制在自然概括范围。')
  } else {
    reasons.push('缺少页面描述。')
  }

  if (contentChars >= minimumContent + 260) {
    score += 25
    strengths.push('正文信息量充足')
  } else if (contentChars >= minimumContent) {
    score += 20
    strengths.push('正文达到该页面类型的基本信息量')
  } else if (contentChars >= Math.max(180, minimumContent - 180)) {
    score += 12
    reasons.push('正文偏短，建议补足真实场景、流程和风险信息。')
  } else {
    score += 4
    reasons.push('页面补充正文偏短，建议补充真实业务信息。')
  }

  if (headings >= 4) {
    score += 10
    strengths.push('正文结构清晰')
  } else if (headings >= 2) {
    score += 6
    reasons.push('小节结构偏少，建议增加有信息量的小节。')
  } else if (contentChars >= 500) {
    score += 2
    reasons.push('缺少清晰 H2/H3 结构。')
  }

  if (keywords.length >= 3 && keywords.length <= 5) {
    score += 8
    strengths.push('SEO 主题词数量符合 3-5 个规则')
  } else if (keywords.length > 0) {
    score += 3
    reasons.push('SEO 主题词数量不在 3-5 个范围。')
  } else {
    reasons.push('缺少页面主题词。')
  }

  if (keywordEvidence === keywords.length && keywords.length > 0) {
    score += 8
    strengths.push('SEO 主题词都能在标题/摘要/正文找到语义证据')
  } else if (keywordEvidence > 0) {
    score += 4
    reasons.push('部分 SEO 主题词没有正文证据，建议删掉无关词。')
  } else if (keywords.length) {
    reasons.push('SEO 主题词与实际内容匹配度低。')
  }

  if (isRedundantKeywordSet(keywords)) {
    score -= 8
    reasons.push('SEO 主题词存在包含关系，可能造成关键词堆叠。')
  }

  if (/本文由\s*AI|AI\s*图解/i.test(page.content)) {
    score -= 8
    reasons.push('正文仍包含生产过程标记，不建议作为前台正式内容。')
  }

  if (page.opportunityScore !== undefined && page.opportunityScore <= 0) {
    score -= 12
    reasons.push('对应关键词机会分不高，不建议继续作为 SEO 入口。')
  }

  if (page.aiGenerated && contentChars < 600) {
    score -= 5
    reasons.push('AI 生成内容信息量不足，建议重新生成或人工补充。')
  }

  score = Math.max(0, Math.min(100, Math.round(score)))

  let status: SeoAuditResult['status'] = 'weak'
  let label = '页面信息不足，建议补充'
  if (score >= 82) {
    status = 'good'
    label = '收录基础条件较完整'
  } else if (score >= 68) {
    status = 'optimize'
    label = '具备收录基础，建议优化'
  } else if (score >= 50) {
    status = 'weak'
    label = '页面价值偏弱，建议先优化'
  }

  return {
    score,
    indexable: true,
    status,
    label,
    reasons: reasons.slice(0, 5),
    strengths: strengths.slice(0, 5),
    metrics: { contentChars, titleChars, descriptionChars, headings, keywordCount: keywords.length, keywordEvidence },
  }
}

export function summarizeSeoAudit(results: SeoAuditResult[]) {
  const total = results.length
  const average = total ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / total) : 0
  return {
    total,
    average,
    good: results.filter((r) => r.status === 'good').length,
    optimize: results.filter((r) => r.status === 'optimize').length,
    weak: results.filter((r) => r.status === 'weak').length,
    blocked: results.filter((r) => r.status === 'blocked').length,
    indexable: results.filter((r) => r.indexable).length,
    lowQuality: results.filter((r) => r.indexable && r.score < 50).length,
  }
}
