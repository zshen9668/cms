import { preferReadable } from './textEncoding'

export type ManagedPageKey = 'home' | 'services' | 'cases' | 'cities' | 'articles' | 'about' | 'contact'
export type PageMode = 'internal' | 'external' | 'hidden'

export type ManagedPage = {
  key: ManagedPageKey
  label: string
  path: string
  labelZh: string
  labelEn: string
  mode: PageMode
  externalUrl: string
  titleZh: string
  titleEn: string
  subtitleZh: string
  subtitleEn: string
  contentZh: string
  contentEn: string
  seoKeywordsZh: string
  seoKeywordsEn: string
  aiGenerated: boolean
  showForm: boolean
}

export const MANAGED_PAGE_META: Array<{ key: ManagedPageKey; label: string; path: string }> = [
  { key: 'home', label: '首页', path: '/' },
  { key: 'services', label: '服务项目', path: '/service' },
  { key: 'cases', label: '成功案例', path: '/case' },
  { key: 'cities', label: '服务城市', path: '/city' },
  { key: 'articles', label: '新闻资讯', path: '/article' },
  { key: 'about', label: '关于我们', path: '/about' },
  { key: 'contact', label: '联系我们', path: '/contact' },
]

const DEFAULTS: Record<ManagedPageKey, ManagedPage> = {
  home: { key: 'home', label: '首页', path: '/', labelZh: '首页', labelEn: 'Home', mode: 'internal', externalUrl: '', titleZh: '', titleEn: '', subtitleZh: '', subtitleEn: '', contentZh: '', contentEn: '', seoKeywordsZh: '', seoKeywordsEn: '', aiGenerated: false, showForm: true },
  services: { key: 'services', label: '服务项目', path: '/service', labelZh: '服务项目', labelEn: 'Services', mode: 'internal', externalUrl: '', titleZh: '', titleEn: '', subtitleZh: '', subtitleEn: '', contentZh: '', contentEn: '', seoKeywordsZh: '', seoKeywordsEn: '', aiGenerated: false, showForm: true },
  cases: { key: 'cases', label: '成功案例', path: '/case', labelZh: '成功案例', labelEn: 'Case studies', mode: 'internal', externalUrl: '', titleZh: '', titleEn: '', subtitleZh: '', subtitleEn: '', contentZh: '', contentEn: '', seoKeywordsZh: '', seoKeywordsEn: '', aiGenerated: false, showForm: true },
  cities: { key: 'cities', label: '服务城市', path: '/city', labelZh: '服务城市', labelEn: 'Cities', mode: 'internal', externalUrl: '', titleZh: '', titleEn: '', subtitleZh: '', subtitleEn: '', contentZh: '', contentEn: '', seoKeywordsZh: '', seoKeywordsEn: '', aiGenerated: false, showForm: true },
  articles: { key: 'articles', label: '新闻资讯', path: '/article', labelZh: '新闻资讯', labelEn: 'Insights', mode: 'internal', externalUrl: '', titleZh: '', titleEn: '', subtitleZh: '', subtitleEn: '', contentZh: '', contentEn: '', seoKeywordsZh: '', seoKeywordsEn: '', aiGenerated: false, showForm: true },
  about: { key: 'about', label: '关于我们', path: '/about', labelZh: '关于我们', labelEn: 'About Us', mode: 'internal', externalUrl: '', titleZh: '', titleEn: '', subtitleZh: '', subtitleEn: '', contentZh: '', contentEn: '', seoKeywordsZh: '', seoKeywordsEn: '', aiGenerated: false, showForm: true },
  contact: { key: 'contact', label: '联系我们', path: '/contact', labelZh: '联系我们', labelEn: 'Contact', mode: 'internal', externalUrl: '', titleZh: '', titleEn: '', subtitleZh: '', subtitleEn: '', contentZh: '', contentEn: '', seoKeywordsZh: '', seoKeywordsEn: '', aiGenerated: false, showForm: true },
}

export function getPageSettings(settings: Record<string, string>): Record<ManagedPageKey, ManagedPage> {
  let raw: any = {}
  try {
    raw = settings.page_settings_json ? JSON.parse(settings.page_settings_json) : {}
  } catch {
    raw = {}
  }

  const result = {} as Record<ManagedPageKey, ManagedPage>
  for (const meta of MANAGED_PAGE_META) {
    const base = DEFAULTS[meta.key]
    const input = raw?.[meta.key] || {}
    result[meta.key] = {
      ...base,
      ...input,
      key: meta.key,
      label: meta.label,
      path: meta.path,
      labelZh: typeof input.labelZh === 'string' ? input.labelZh : base.labelZh,
      labelEn: typeof input.labelEn === 'string' ? input.labelEn : base.labelEn,
      mode: input.mode === 'external' || input.mode === 'hidden' ? input.mode : 'internal',
      externalUrl: typeof input.externalUrl === 'string' ? input.externalUrl.trim() : '',
      titleZh: typeof input.titleZh === 'string' ? input.titleZh : '',
      titleEn: typeof input.titleEn === 'string' ? input.titleEn : '',
      subtitleZh: typeof input.subtitleZh === 'string' ? input.subtitleZh : '',
      subtitleEn: typeof input.subtitleEn === 'string' ? input.subtitleEn : '',
      contentZh: typeof input.contentZh === 'string' ? input.contentZh : '',
      contentEn: typeof input.contentEn === 'string' ? input.contentEn : '',
      seoKeywordsZh: typeof input.seoKeywordsZh === 'string' ? input.seoKeywordsZh : '',
      seoKeywordsEn: typeof input.seoKeywordsEn === 'string' ? input.seoKeywordsEn : '',
      aiGenerated: input.aiGenerated === true,
      showForm: input.showForm !== false,
    }
  }
  return result
}

export function serializePageSettings(pages: Record<ManagedPageKey, ManagedPage>): string {
  const compact: Record<string, any> = {}
  for (const meta of MANAGED_PAGE_META) {
    const p = pages[meta.key]
    compact[meta.key] = {
      mode: p.mode,
      labelZh: p.labelZh,
      labelEn: p.labelEn,
      externalUrl: p.externalUrl,
      titleZh: p.titleZh,
      titleEn: p.titleEn,
      subtitleZh: p.subtitleZh,
      subtitleEn: p.subtitleEn,
      contentZh: p.contentZh,
      contentEn: p.contentEn,
      seoKeywordsZh: p.seoKeywordsZh,
      seoKeywordsEn: p.seoKeywordsEn,
      aiGenerated: p.aiGenerated === true,
      showForm: p.showForm,
    }
  }
  return JSON.stringify(compact)
}

export function isManagedPageKey(value: string): value is ManagedPageKey {
  return MANAGED_PAGE_META.some((p) => p.key === value)
}

export function getPageNavigationLabels(settings: Record<string, string>, locale: 'zh-CN' | 'en' = 'zh-CN'): Record<ManagedPageKey, string> {
  const pages = getPageSettings(settings)
  const result = {} as Record<ManagedPageKey, string>
  for (const meta of MANAGED_PAGE_META) {
    const page = pages[meta.key]
    const value = locale === 'zh-CN' ? page.labelZh : page.labelEn
    // 存进去的标签可能是编码错乱的（见 textEncoding.ts）。乱码时回退到内置标签，
    // 否则侧边栏会直接显示一串乱码，站长还以为后台坏了。
    result[meta.key] = preferReadable(value, meta.label)
  }
  return result
}


export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
