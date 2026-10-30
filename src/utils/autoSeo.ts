import type { SiteProfile } from './siteProfile'

export type SeoFields = { seo_title: string; seo_description: string; seo_keywords: string }

function normalizeKeyword(value: unknown): string {
  return String(value || '')
    .replace(/[\u0000\r\t]+/g, ' ')
    .replace(/[|｜]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,，;；、]+|[,，;；、]+$/g, '')
    .slice(0, 80)
}

function normalizeKeywordList(value: string | string[], max: number): string[] {
  const values = Array.isArray(value) ? value : String(value || '').split(/[,，;；\n、]+/)
  const limit = Math.max(1, Math.trunc(Number.isFinite(max) ? max : 1))
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const keyword = normalizeKeyword(raw)
    const key = keyword.toLocaleLowerCase()
    if (!keyword || seen.has(key)) continue
    seen.add(key)
    result.push(keyword)
    if (result.length >= limit) break
  }
  return result
}

export function normalizeSeoKeywords(value: string | string[], max = 5): string[] {
  // 页面 SEO 元数据硬限制为最多 5 个；调用方不能通过 max 绕过页面级上限。
  return normalizeKeywordList(value, Math.min(5, Math.max(1, Math.trunc(Number(max) || 5))))
}

export function normalizeKeywordCandidates(value: string | string[], max = 12): string[] {
  // 候选词属于词库，不等于页面 seo_keywords；默认最多 12 个，可在后台继续筛选。
  return normalizeKeywordList(value, Math.min(20, Math.max(1, Math.trunc(Number(max) || 12))))
}

function uniqueKeywords(values: string[], max = 5): string {
  return selectSeoKeywords(values, max).join(',')
}

const ARTICLE_TOPIC_KEYWORDS = [
  '行业资讯', '服务指南', '业务流程', '解决方案',
  '项目服务', '产品信息', '常见问题', '注意事项', '服务范围',
] as const

function hasKeywordEvidence(keyword: string, text: string): boolean {
  const term = normalizeKeyword(keyword).toLocaleLowerCase()
  if (!term) return false
  const normalizedText = normalizeKeyword(text).toLocaleLowerCase()
  return normalizedText.includes(term)
}

function removeRedundantNestedKeywords(keywords: string[], max = 5): string[] {
  const normalized = normalizeSeoKeywords(keywords, Math.min(12, Math.max(1, max)))
  const ranked = [...normalized].sort((a, b) => {
    const lengthDiff = b.replace(/\s+/g, '').length - a.replace(/\s+/g, '').length
    return lengthDiff || normalized.indexOf(a) - normalized.indexOf(b)
  })
  const kept: string[] = []
  for (const keyword of ranked) {
    const compact = keyword.replace(/\s+/g, '').toLocaleLowerCase()
    if (!compact) continue
    const redundant = kept.some((existing) => {
      const existingCompact = existing.replace(/\s+/g, '').toLocaleLowerCase()
      return existingCompact.length > compact.length && existingCompact.includes(compact)
    })
    if (!redundant) kept.push(keyword)
    if (kept.length >= max) break
  }
  return kept
}

function selectSeoKeywords(candidates: string[], max = 5): string[] {
  return removeRedundantNestedKeywords(candidates, max)
}

export function alignSeoKeywordsToContent(
  value: string | string[],
  title = '',
  summary = '',
  content = '',
  max = 5,
): string[] {
  const text = title + ' ' + summary + ' ' + content
  const candidates = normalizeKeywordList(value, 20)
  return selectSeoKeywords(candidates.filter((keyword) => hasKeywordEvidence(keyword, text)), max)
}

export const SITE_SEO_FOCUS_KEYWORDS = [
  '行业资讯', '服务指南', '业务流程', '解决方案',
  '项目服务', '产品信息', '常见问题', '注意事项', '服务范围',
] as const

function topicSemanticMatches(text: string): string[] {
  const normalized = normalizeKeyword(text).toLocaleLowerCase()
  return normalizeSeoKeywords(
    SITE_SEO_FOCUS_KEYWORDS.filter((term) => normalized.includes(term.toLocaleLowerCase())),
    12,
  )
}

export function buildArticleSeoKeywords(
  title: string,
  summary = '',
  content = '',
  globalKeywords = '',
  profile?: SiteProfile,
): string[] {
  const text = title + ' ' + summary + ' ' + content
  const profileKeywords = [...(profile?.primaryKeywords || []), ...(profile?.industryKeywords || [])]
  const globalMatched = normalizeKeywordList(globalKeywords, 15)
    .filter((keyword) => hasKeywordEvidence(keyword, text))
  const profileMatched = profileKeywords.filter((keyword) => hasKeywordEvidence(keyword, text))
  const genericTopics = ARTICLE_TOPIC_KEYWORDS.filter((keyword) => hasKeywordEvidence(keyword, text))
  return selectSeoKeywords([...globalMatched, ...profileMatched, ...topicSemanticMatches(text), ...genericTopics], 5)
}

export function autoServiceSeo(service: { name: string; summary?: string }, siteName = '网站内容平台', globalKeywords = '', profile?: SiteProfile): SeoFields {
  const name = String(service.name || '').trim()
  const summary = String(service.summary || '').trim()
  const topic = profile?.topic || profile?.industry || normalizeKeywordList(globalKeywords, 1)[0] || ''
  const seoDescription = [
    name ? name + (topic ? '：围绕' + topic : '') : '',
    '提供适用场景、服务范围、办理流程和注意事项等清晰、可执行的信息。',
    summary,
  ].filter(Boolean).join(' ').slice(0, 180)
  const context = name + ' ' + summary + ' ' + seoDescription
  const related = normalizeKeywordList([...(profile?.primaryKeywords || []), ...(profile?.industryKeywords || []), globalKeywords], 20)
    .filter((keyword) => hasKeywordEvidence(keyword, context))
  return {
    seo_title: (name + (name && siteName ? ' - ' : '') + siteName).slice(0, 120),
    seo_description: seoDescription,
    seo_keywords: uniqueKeywords([name, topic, '办理流程', '注意事项', ...related].filter(Boolean), 5),
  }
}

export function autoCitySeo(city: { name: string }, siteName = '网站内容平台', globalKeywords = '', profile?: SiteProfile): SeoFields {
  const name = String(city.name || '').trim()
  const topic = profile?.topic || profile?.industry || normalizeKeywordList(globalKeywords, 1)[0] || ''
  const topicPrefix = topic ? name + topic : name
  const seoDescription = [topicPrefix, '提供本地区的适用场景、服务范围、办理流程和注意事项等公开信息。'].filter(Boolean).join(' ').slice(0, 180)
  const context = name + ' ' + topic + ' ' + seoDescription
  const related = normalizeKeywordList([...(profile?.primaryKeywords || []), ...(profile?.industryKeywords || []), globalKeywords], 20)
    .filter((keyword) => hasKeywordEvidence(keyword, context))
  return {
    seo_title: (topicPrefix + (siteName ? ' - ' + siteName : '')).slice(0, 120),
    seo_description: seoDescription,
    seo_keywords: uniqueKeywords([topicPrefix, name + '服务', '办理流程', '注意事项', ...related].filter(Boolean), 5),
  }
}

export function autoArticleSeo(article: { title: string; summary?: string; content?: string }, siteName = '网站内容平台', globalKeywords = '', profile?: SiteProfile): SeoFields {
  const title = String(article.title || '').trim()
  const summary = String(article.summary || '').trim()
  const content = String(article.content || '').trim()
  const matched = buildArticleSeoKeywords(title, summary, content, globalKeywords, profile)
  return {
    seo_title: (title + ' - ' + siteName).slice(0, 120),
    seo_description: (summary || title + '相关公开信息与实务指南。').slice(0, 180),
    seo_keywords: matched.join(','),
  }
}
