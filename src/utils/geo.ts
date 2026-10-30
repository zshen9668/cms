export const HUMAN_REVIEW_PUBLICATION_MODE = 'AI通过质量门槛后进入人工审核，人工发布后才公开'

export const PUBLICATION_PIPELINE = [
  '事实来源',
  '来源抓取/分析',
  'AI整理/独立写作',
  '质量门槛',
  'pending_review',
  '人工审核',
  'published',
  'Sitemap',
  '百度普通收录通知',
  'IndexNow',
  '国内内容/视频发布包',
] as const

export function breadcrumbJsonLd(siteUrl: string, items: Array<{ name: string; path: string }>) {
  const origin = String(siteUrl || '').replace(/\/$/, '')
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: origin + item.path,
    })),
  }
}

export function escapeLike(value: string): string {
  return String(value || '').replace(/([%_\\])/g, '\\$1')
}

export function pageDocumentTitle(pageTitle: string, siteName: string): string {
  const title = String(pageTitle || '').trim()
  const name = String(siteName || '').trim()
  if (title && name && title !== name) return title + ' - ' + name
  return title || name || '网站内容平台'
}

/** Only allow same-site relative paths for redirects (no open redirect). */
export function safeInternalPath(value: unknown, fallback = '/'): string {
  const raw = String(value || '').trim()
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return fallback
  const pathOnly = raw.split('#')[0] ?? ''
  return pathOnly.slice(0, 500) || fallback
}
