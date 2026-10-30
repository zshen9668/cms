/**
 * 成功案例（Case Studies）数据层与结构化数据构造。
 *
 * 与 cities / services 的差别：案例自带正文、成果数据与客户评价，内容直接存在 cases 表，
 * 不像城市那样把正文塞进 settings 的动态键 ai_page:*。增删改只需动一张表，
 * 备份、迁移与缓存失效都更简单。
 *
 * 城市页 /city/... 不受影响，继续承担本地 SEO / GEO 收录。
 */
import type { Bindings } from '../types'

export type CaseRecord = {
  id: number
  tenant_id: number
  client_name: string
  slug: string
  industry: string
  service_name: string
  region: string
  summary: string
  challenge: string
  solution: string
  results: string
  testimonial: string
  content: string
  cover_image_url: string
  project_url: string
  is_featured: number
  is_active: number
  sort_order: number
  seo_title: string
  seo_description: string
  seo_keywords: string
  created_at: string
  updated_at: string
}

/** URL 标识规则，与 cities / services 保持一致，便于 sitemap 与缓存键统一处理。 */
export const CASE_SLUG_PATTERN = /^[a-z0-9-]+$/
export const CASE_SLUG_MAX = 60
/** 成果数据最多保留多少行——列表与结构化数据都只会取用这些。 */
export const CASE_RESULT_MAX_LINES = 12
export const CASE_LIST_LIMIT = 60
export const CASE_HOME_LIMIT = 6

/**
 * 从客户名/行业推导 URL 标识。
 *
 * 不引入拼音库：中文客户名会推导出空串，此时由后台表单要求人工填写，
 * 避免生成 case-1 / case-2 这种对收录毫无意义的地址。
 */
export function suggestCaseSlug(clientName: string, industry = ''): string {
  const normalize = (value: string) =>
    String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
  for (const candidate of [normalize(clientName), normalize(industry)]) {
    if (candidate.length >= 2 && /[a-z]/.test(candidate)) return candidate.slice(0, CASE_SLUG_MAX)
  }
  return ''
}

/**
 * 返回 null 表示通过，否则返回给用户看的中文原因。
 * 输入会先转小写并去掉首尾空白，所以 "Shenzhen" 会被规范化后通过；
 * 真正落库的值同样以 readCaseInput 规范化后的结果为准。
 */
export function validateCaseSlug(raw: string): string | null {
  const slug = String(raw || '').trim().toLowerCase()
  if (!slug) return '请填写案例网址标识（小写英文、数字或短横线）'
  if (!CASE_SLUG_PATTERN.test(slug)) return '案例网址标识只能包含小写英文、数字和短横线，不能有空格或中文'
  if (slug.length > CASE_SLUG_MAX) return `案例网址标识不能超过 ${CASE_SLUG_MAX} 个字符`
  return null
}

/** 成果数据：一行一条，空行忽略。 */
export function parseCaseResults(raw: string): string[] {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*·•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, CASE_RESULT_MAX_LINES)
}

export function casePublicPath(slug: string): string {
  return '/case/' + String(slug || '').trim()
}

/** 案例标题：有客户名就用客户名，否则退回行业 + 案例。 */
export function caseDisplayTitle(row: Pick<CaseRecord, 'client_name' | 'industry' | 'region'>): string {
  const client = String(row.client_name || '').trim()
  if (client) return client
  const fallback = [String(row.region || '').trim(), String(row.industry || '').trim()].filter(Boolean).join('')
  return fallback ? fallback + '案例' : '成功案例'
}

function uniqueKeywords(values: Array<string | undefined>, max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const item = String(value || '').trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    out.push(item)
    if (out.length >= max) break
  }
  return out
}

/**
 * 自动生成案例的 SEO 三要素。
 * 与 autoCitySeo 一样是确定性生成——同样的输入永远得到同样的输出，
 * 便于「自动 SEO」按钮反复执行而不产生漂移。
 */
export function autoCaseSeo(
  input: { clientName: string; industry?: string; serviceName?: string; region?: string; summary?: string },
  siteName: string,
  globalKeywords = '',
): { seo_title: string; seo_description: string; seo_keywords: string } {
  const client = String(input.clientName || '').trim()
  const industry = String(input.industry || '').trim()
  const service = String(input.serviceName || '').trim()
  const region = String(input.region || '').trim()
  const summary = String(input.summary || '').trim()
  const subject = [region, industry].filter(Boolean).join('')

  const titleParts = [client, subject ? subject + '案例' : '成功案例', service].filter(Boolean)
  const seo_title = (titleParts.join(' - ') + ' | ' + siteName).slice(0, 60)

  const fallbackDescription =
    [client, subject ? '（' + subject + '）' : '', '项目的完整交付案例，包含客户背景、项目挑战、实施方案与实际成果数据。']
      .filter(Boolean)
      .join('')
  const seo_description = (summary || fallbackDescription).slice(0, 150)

  const globalPool = String(globalKeywords || '')
    .split(/[,，;；\n、]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6)

  const seo_keywords = uniqueKeywords(
    [
      client && client + '案例',
      subject && subject + '案例',
      industry,
      service,
      region,
      client,
      ...globalPool,
    ],
    12,
  ).join(',')

  return { seo_title, seo_description, seo_keywords }
}

/** 案例详情页的结构化数据：用 schema.org 的 Article 表达案例正文。 */
export function buildCaseJsonLd(input: {
  siteName: string
  siteUrl: string
  slug: string
  title: string
  description: string
  clientName: string
  industry: string
  serviceName: string
  region: string
  imageUrl?: string
  publishedAt?: string
  modifiedAt?: string
  projectUrl?: string
}): Record<string, unknown> {
  const site = input.siteUrl.replace(/\/$/, '')
  const pageUrl = site + casePublicPath(input.slug)

  const about: Array<Record<string, unknown>> = []
  if (input.clientName) about.push({ '@type': 'Organization', name: input.clientName })
  if (input.industry) about.push({ '@type': 'Thing', name: input.industry })
  if (input.serviceName) about.push({ '@type': 'Service', name: input.serviceName, ...(input.region ? { areaServed: input.region } : {}) })

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title.slice(0, 110),
    description: input.description.slice(0, 300),
    inLanguage: 'zh-CN',
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    url: pageUrl,
    author: { '@type': 'Organization', name: input.siteName, url: site },
    publisher: { '@type': 'Organization', name: input.siteName, url: site, logo: { '@type': 'ImageObject', url: site + '/icons/icon-512.png' } },
  }
  if (about.length) jsonLd.about = about
  if (input.imageUrl) jsonLd.image = [input.imageUrl]
  if (input.publishedAt) jsonLd.datePublished = input.publishedAt
  if (input.modifiedAt) jsonLd.dateModified = input.modifiedAt
  if (input.projectUrl) jsonLd.sameAs = [input.projectUrl]
  return jsonLd
}

/**
 * 前台可见的案例：已启用即公开。
 * 案例没有草稿态——没写完的案例直接留停用即可，避免再维护一套状态机。
 */
export function isCasePublic(row: Pick<CaseRecord, 'is_active'>): boolean {
  return Number(row?.is_active || 0) === 1
}

const CASE_COLUMNS = 'id, tenant_id, client_name, slug, industry, service_name, region, summary, challenge, solution, results, testimonial, content, cover_image_url, project_url, is_featured, is_active, sort_order, seo_title, seo_description, seo_keywords, created_at, updated_at'

/** 列表页用：精选优先，其次按人工排序。 */
export async function getPublicCases(env: Pick<Bindings, 'DB'>, tenantId: number, limit = CASE_LIST_LIMIT): Promise<CaseRecord[]> {
  const rows = await env.DB.prepare(
    `SELECT ${CASE_COLUMNS} FROM cases WHERE tenant_id = ? AND is_active = 1 ORDER BY is_featured DESC, sort_order, id LIMIT ?`,
  ).bind(tenantId, limit).all()
  return rows.results as unknown as CaseRecord[]
}

/** 首页「成功案例」模块用：只取精选，没有精选时回退到排序靠前的案例。 */
export async function getHomeCases(env: Pick<Bindings, 'DB'>, tenantId: number, limit = CASE_HOME_LIMIT): Promise<CaseRecord[]> {
  const featured = await env.DB.prepare(
    `SELECT ${CASE_COLUMNS} FROM cases WHERE tenant_id = ? AND is_active = 1 AND is_featured = 1 ORDER BY sort_order, id LIMIT ?`,
  ).bind(tenantId, limit).all()
  const rows = featured.results as unknown as CaseRecord[]
  if (rows.length) return rows
  return getPublicCases(env, tenantId, limit)
}

export async function getCaseBySlug(env: Pick<Bindings, 'DB'>, tenantId: number, slug: string): Promise<CaseRecord | null> {
  const row = await env.DB.prepare(
    `SELECT ${CASE_COLUMNS} FROM cases WHERE tenant_id = ? AND slug = ?`,
  ).bind(tenantId, slug).first()
  return (row as unknown as CaseRecord) || null
}

/** 计数：用于首页模块标题与后台概览。 */
export async function countPublicCases(env: Pick<Bindings, 'DB'>, tenantId: number): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM cases WHERE tenant_id = ? AND is_active = 1').bind(tenantId).first() as { n?: number } | null
  return Number(row?.n || 0)
}
