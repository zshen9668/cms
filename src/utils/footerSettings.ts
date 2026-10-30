import type { Locale } from './localeResolve'

export type FooterLink = { label: string; href: string }

export type FooterSettings = {
  copyright: string
  disclaimer: string
  aiNotice: string
  links: FooterLink[]
}

const DEFAULT_DISCLAIMER: Record<Locale, string> = {
  'zh-CN': '本站内容仅供参考',
  en: 'Content is for reference only',
}

/**
 * Footer is driven by D1 settings so white-label sites can change copyright,
 * disclaimer, AI notice and bottom links without editing templates.
 * Empty fields fall back to locale defaults (not industry-specific).
 */
export function getFooterSettings(
  settings: Record<string, string> = {},
  siteName = '',
  locale: Locale = 'zh-CN',
): FooterSettings {
  const year = new Date().getFullYear()
  const name = String(siteName || settings.site_name || '').trim()
  const copyright = String(settings.footer_copyright || '').trim()
    || `© ${year}${name ? ' ' + name : ''}`
  const disclaimer = String(settings.footer_disclaimer || '').trim()
    || DEFAULT_DISCLAIMER[locale] || DEFAULT_DISCLAIMER['zh-CN']
  const aiNotice = String(settings.footer_ai_notice || '').trim()
  const links = parseFooterLinks(String(settings.footer_links || ''))
  return { copyright, disclaimer, aiNotice, links }
}

/** One link per line: "Label|/path" or "Label|https://..." */
export function parseFooterLinks(raw: string): FooterLink[] {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
  const items: FooterLink[] = []
  for (const line of lines) {
    const sep = line.includes('|') ? '|' : null
    if (!sep) continue
    const idx = line.indexOf(sep)
    const label = line.slice(0, idx).trim().slice(0, 40)
    const href = line.slice(idx + 1).trim().slice(0, 300)
    if (!label || !href) continue
    if (!href.startsWith('/') && !/^https:\/\//i.test(href)) continue
    items.push({ label, href })
  }
  return items
}
