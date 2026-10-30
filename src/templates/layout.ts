import { t, localeBcp47, ogLocale, type Locale } from '../utils/i18n'
import { DEFAULT_LOCALE } from '../utils/localeResolve'
import { STYLESHEET_HREF, MAIN_SCRIPT_HREF } from './assets'
import { escapeHtml } from '../utils/html'
// 统一从 utils/html 转发导出:历史上这里自己实现了一份 escapeHtml,与其它 4 处副本重复。
// 保留导出名不变,所有 `import { escapeHtml } from './layout'` 的调用点无需改动。
export { escapeHtml }
import type { ContactMethods } from '../utils/contactSettings'
import type { ContactChannel } from '../modules/contactChannels/types'
import { filterContactChannels } from '../modules/contactChannels/service'
import type { NavigationItem } from '../modules/navigation/service'
import { DEFAULT_NAVIGATION, getBottomNavigation, getMobileNavigation } from '../modules/navigation/service'
import type { LanguageOption } from '../modules/languageManager/index'
import { DEFAULT_LANGUAGES } from '../modules/languageManager/index'
import { renderAdminLayout, sanitizeAdminPreviewHtml } from './adminLayout'
import { renderCtaWidget } from './cta'

/** 作者实体（E-E-A-T）：GEO 里 AI 引擎判断内容可信度的核心信号之一。 */
export type LayoutAuthor = {
  name: string
  url?: string
  jobTitle?: string
  /** 资质说明，例如「执业律师 10 年」「注册建筑师」。会写入 Person.description 与 knowsAbout。 */
  credentials?: string
  knowsAbout?: string[]
}

export type LayoutBreadcrumb = { name: string; path: string }

export type LayoutOptions = {
  title: string
  description?: string
  keywords?: string
  siteUrl: string
  siteName: string
  canonical?: string
  robots?: string
  bodyClass?: string
  locale?: Locale
  currentPath?: string
  extraJsonLd?: Record<string, unknown>[]
  contactMethods?: ContactMethods
  /** Canonical contact channel records. When provided, display flags control each surface. */
  contactChannels?: ContactChannel[]
  navLabels?: Partial<Record<'home' | 'services' | 'cases' | 'cities' | 'articles' | 'about' | 'contact', string>>
  /** Full navigation items (order/enabled/mobileOrder). When omitted, falls back to defaults + navLabels. */
  navItems?: NavigationItem[]
  articleCategories?: Array<{ name: string; path: string; count: number }>
  /** Enabled languages for the language switcher. English hidden when not enabled. */
  languages?: LanguageOption[]
  /**
   * 站点默认语言（由语言设置决定）。用于多语言 SEO：
   * 非默认语言的页面把 `?lang=xx` 写进 canonical，并输出 hreflang 互指，
   * 让搜索引擎能分别收录中英文版本，而不是把两者当成同一份重复内容。
   */
  defaultLocale?: Locale
  /** 前台智能问答组件（关闭时不输出任何 DOM 与脚本）。 */
  aiQa?: { enabled: boolean }
  /** 前台智能问答 Turnstile 站点密钥（配置后聊天窗口渲染人机校验）。 */
  aiQaTurnstileSiteKey?: string
  /** CSP nonce，用于内联脚本白名单。由 securityHeaders 中间件生成。 */
  cspNonce?: string
  /** Footer text driven by /admin/settings (white-label). */
  footerCopyright?: string
  footerDisclaimer?: string
  footerAiNotice?: string
  footerLinks?: Array<{ label: string; href: string }>

  // --- GEO / 结构化数据 -----------------------------------------------------
  /** 页面主图（share/og 图）。相对路径会按 siteUrl 补成绝对地址。 */
  image?: string
  imageAlt?: string
  /** 站点级默认分享图；未提供时回退到站点图标。 */
  defaultImage?: string
  /** og:type。文章页传 'article' 会额外输出发布/修改时间与作者。 */
  ogType?: 'website' | 'article' | 'profile'
  publishedTime?: string
  modifiedTime?: string
  /** 作者实体。会被 WebPage/Article 通过 @id 引用，供 AI 引擎做可信度判断。 */
  author?: LayoutAuthor
  /** 面包屑。提供后输出 BreadcrumbList 结构化数据。 */
  breadcrumbs?: LayoutBreadcrumb[]
  /** 站点 logo 绝对地址；Organization.logo 是 Google 富结果的必需字段。 */
  logoUrl?: string
  /** 站点图标 URL；配置后输出 <link rel="icon">，未配置则不输出（保持原有 /icons/icon-512.png apple-touch-icon 行为）。 */
  siteFavicon?: string
  /** 站点在其它平台的官方主页（微博、公众号、知乎等），用于 Organization.sameAs。 */
  sameAs?: string[]
  /** 前台 CTA 悬浮区块：开关（缺省开启）。 */
  siteCtaEnabled?: string
  /** 前台 CTA 按钮文案。 */
  siteCtaTitle?: string
  /** 前台 CTA 副标题。 */
  siteCtaSubtitle?: string
  /** 前台 CTA 按钮文字。 */
  siteCtaBtnText?: string
  /** 统计脚本片段（GA4/百度统计/CF Analytics 等，原样输出）。 */
  siteAnalyticsSnippet?: string
  /** 统计脚本开关。 */
  siteAnalyticsEnabled?: string
}

/** 把可能是相对路径的图片地址补成绝对地址——og:image 必须是绝对 URL。 */
export function absoluteUrl(siteUrl: string, value: string): string {
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return siteUrl.replace(/\/$/, '') + (value.startsWith('/') ? value : '/' + value)
}

export function renderLayout(opts: LayoutOptions, body: string): string {
  const {
    title, description = '', siteUrl, siteName, canonical = siteUrl, bodyClass = '',
    locale = 'zh-CN', currentPath = '/', extraJsonLd = [], cspNonce = '',
    siteCtaEnabled, siteCtaTitle, siteCtaSubtitle, siteCtaBtnText,
    siteAnalyticsEnabled, siteAnalyticsSnippet,
    siteFavicon,
  } = opts
  const defaultLocale: Locale = opts.defaultLocale || DEFAULT_LOCALE
  const isDefaultLocale = locale === defaultLocale

  // 默认放行抓取，并显式放开摘要长度与图片预览尺寸——AI 引擎与搜索摘要都需要更完整的正文片段。
  const robots = opts.robots || 'index,follow,max-image-preview:large,max-snippet:-1'

  const contactMethods = opts.contactMethods
  const contactChannels = opts.contactChannels
  const headerChannels = contactChannels ? filterContactChannels(contactChannels, 'header') : []
  const footerChannels = contactChannels ? filterContactChannels(contactChannels, 'footer') : []
  const headerWechatValues = headerChannels
    .filter((channel) => channel.type === 'wechat')
    .slice(0, 2)
    .map((channel) => channel.value)
  const navLabels = opts.navLabels || {}

  const navItems: NavigationItem[] = (opts.navItems && opts.navItems.length)
    ? opts.navItems
    : DEFAULT_NAVIGATION.map((item) => ({
        ...item,
        label: (navLabels as any)[item.key] || item.label,
      }))

  const desktopNav = [...navItems].sort((a, b) => a.sortOrder - b.sortOrder)
  const mobileNav = getMobileNavigation(navItems)
  const bottomNav = getBottomNavigation(navItems)

  const languages = (opts.languages && opts.languages.length) ? opts.languages : DEFAULT_LANGUAGES
  const enabledLanguages = languages.filter((l) => l.enabled !== false)
  const showLangSwitcher = enabledLanguages.length > 1

  // --- 多语言 URL ------------------------------------------------------------
  // 语言以 cookie + `?lang=` 双通道表达：cookie 让访客的浏览保持语言，
  // `?lang=` 让每种语言都有一个可被爬虫抓取、可被 hreflang 引用的独立 URL。
  // 非默认语言页面的 canonical 指向带 `?lang=` 的自身地址（自指），
  // 否则 Google 会把英文页当成中文页的重复内容而不收录。
  const langQueryPattern = /([?&])lang=[^&]*&?/
  const baseCanonical = canonical.replace(langQueryPattern, '$1').replace(/[?&]$/, '')
  const withLang = (url: string, code: string): string => {
    if (code === defaultLocale) return url
    const separator = url.includes('?') ? '&' : '?'
    return url + separator + 'lang=' + encodeURIComponent(code)
  }
  const canonicalUrl = withLang(baseCanonical, locale)
  // hreflang 只在可索引页面上输出：noindex 页（搜索结果）互相引用没有意义。
  const hreflangLinks = (robots.includes('noindex') || enabledLanguages.length < 2)
    ? ''
    : enabledLanguages.map((lang) => {
        const code = lang.code === 'en-US' ? 'en' : lang.code
        return `<link rel="alternate" hreflang="${escapeHtml(code)}" href="${escapeHtml(withLang(baseCanonical, code))}" />`
      }).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${escapeHtml(baseCanonical)}" />`

  /** 语言切换链接：走 /lang/:code 路由，由服务端显式写入对应语言的持久 cookie（含默认语言）。
   * 避免直接带 ?lang= 回源：切回默认语言时会移除 ?lang=，导致一次性 _langq 没写入，
   * 而持久 lang=en 仍在，造成「切到英文后切不回中文」。 */
  const langSwitchHref = (code: string): string => {
    const [path, ...rest] = String(currentPath || '/').split('?')
    const params = new URLSearchParams(rest.join('?'))
    params.set('back', (path || '/') + (rest.length ? '?' + rest.join('?') : ''))
    return '/lang/' + code + (params.toString() ? '?' + params.toString() : '')
  }
  const renderLangSwitcher = (): string => {
    if (!showLangSwitcher) return ''
    return `
    <div class="lang-switch" aria-label="${escapeHtml(t(locale, 'lang.switch'))}">
      ${enabledLanguages.map((lang, idx) => {
        const code = lang.code === 'en-US' ? 'en' : lang.code
        const active = locale === code
        const sep = idx > 0 ? '<span>/</span>' : ''
        return `${sep}<a href="${escapeHtml(langSwitchHref(code))}" hreflang="${escapeHtml(code)}"${active ? ' class="active" aria-current="true"' : ''}>${escapeHtml(lang.name)}</a>`
      }).join('')}
    </div>`
  }
  const langSwitcher = renderLangSwitcher()

  const navIsActive = (href: string) => currentPath === href || (href !== '/' && currentPath.startsWith(href + '/'))
  const inArticleArea = currentPath === '/article' || currentPath.startsWith('/article/')
  const categories = inArticleArea ? (opts.articleCategories || []) : []
  const categoryLinks = categories.map((c) => `<a href="${escapeHtml(c.path)}" class="${currentPath === c.path ? 'active' : ''}">${escapeHtml(c.name)}<small>${c.count}</small></a>`).join('')
  const withSub = (item: NavigationItem, html: string) => item.key === 'articles' && categories.length ? `<div class="nav-item-with-sub">${html}<div class="nav-sub">${categoryLinks}</div></div>` : html
  const navLink = (href: string, label: string) =>
    `<a href="${href}" class="${navIsActive(href) ? 'active' : ''}"${navIsActive(href) ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`

  // --- 分享图 ---------------------------------------------------------------
  // 旧版本声明了 twitter:card=summary_large_image 却没有输出任何图片，
  // 平台会退化成无图卡片；这里保证始终有 og:image，并按图片来源选择正确的 card 类型。
  const explicitImage = opts.image ? absoluteUrl(siteUrl, opts.image) : ''
  const fallbackImage = opts.defaultImage ? absoluteUrl(siteUrl, opts.defaultImage) : `${siteUrl.replace(/\/$/, '')}/icons/icon-512.png`
  const shareImage = explicitImage || fallbackImage
  // 只有拿到真实内容图时才用大图卡；否则用 summary，避免用方形站点图标撑成大图。
  const twitterCard = explicitImage ? 'summary_large_image' : 'summary'
  const imageAlt = opts.imageAlt || title

  const logoUrl = opts.logoUrl ? absoluteUrl(siteUrl, opts.logoUrl) : `${siteUrl.replace(/\/$/, '')}/icons/icon-512.png`

  // --- 结构化数据 -----------------------------------------------------------

  const organizationJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': siteUrl + '/#organization',
    name: siteName,
    url: siteUrl,
    // Google 的 Organization 富结果要求 logo；缺失会导致富结果校验失败。
    logo: { '@type': 'ImageObject', url: logoUrl },
  }
  if (opts.sameAs?.length) organizationJsonLd.sameAs = opts.sameAs
  if (description) organizationJsonLd.description = description

  const webSiteJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': siteUrl + '/#website',
    name: siteName,
    alternateName: siteName,
    url: siteUrl,
    publisher: { '@id': siteUrl + '/#organization' },
    inLanguage: localeBcp47(locale),
    potentialAction: {
      '@type': 'SearchAction',
      target: siteUrl + '/search?q={search_term_string}',
      'query-input': 'required name=search_term_string',
    },
  }

  const webPageJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': canonicalUrl + '#webpage',
    url: canonicalUrl,
    name: title,
    description,
    isPartOf: { '@id': siteUrl + '/#website' },
    about: { '@id': siteUrl + '/#organization' },
    inLanguage: localeBcp47(locale),
    primaryImageOfPage: { '@type': 'ImageObject', url: shareImage },
  }
  if (opts.author) {
    webPageJsonLd.author = { '@id': canonicalUrl + '#author' }
    webPageJsonLd.reviewedBy = { '@id': canonicalUrl + '#author' }
  }
  if (opts.publishedTime) webPageJsonLd.datePublished = opts.publishedTime
  if (opts.modifiedTime) webPageJsonLd.dateModified = opts.modifiedTime

  if (contactMethods?.phones.length) {
    organizationJsonLd.contactPoint = contactMethods.phones.map((telephone) => ({
      '@type': 'ContactPoint',
      telephone,
      contactType: 'customer service',
      availableLanguage: locale === 'zh-CN' ? ['Chinese', 'English'] : ['English', 'Chinese'],
      url: siteUrl + '/contact',
    }))
  }

  // 作者实体：AI 引擎判断"谁说的"比"说了什么"更依赖这个。
  const authorJsonLd: Record<string, unknown> | null = opts.author?.name ? {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': canonicalUrl + '#author',
    name: opts.author.name,
    url: opts.author.url ? absoluteUrl(siteUrl, opts.author.url) : canonicalUrl,
    ...(opts.author.jobTitle ? { jobTitle: opts.author.jobTitle } : {}),
    ...(opts.author.credentials ? { description: opts.author.credentials } : {}),
    ...(opts.author.knowsAbout?.length ? { knowsAbout: opts.author.knowsAbout } : {}),
    worksFor: { '@id': siteUrl + '/#organization' },
  } : null

  // 面包屑：geo.ts 里的 breadcrumbJsonLd 此前定义了却从未被调用，这里正式接上。
  const breadcrumbItems = (opts.breadcrumbs || []).filter((b) => b.name && b.path)
  let breadcrumbJsonLd: Record<string, unknown> | null = null
  if (breadcrumbItems.length) {
    const nodes = breadcrumbItems.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(siteUrl, item.path),
    }))
    breadcrumbJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      '@id': canonicalUrl + '#breadcrumb',
      itemListElement: nodes,
    }
    webPageJsonLd.breadcrumb = { '@id': canonicalUrl + '#breadcrumb' }
  }

  /** 把页面上所有 JSON-LD 实体合并成一个 @graph 数组，避免输出多个
   *  <script type="application/ld+json"> 标签。如果只有一个实体，直接返回该实体本身。
   */
  function buildJsonLdGraph(): Record<string, unknown> {
    const entities: Array<Record<string, unknown>> = []
    entities.push(organizationJsonLd, webSiteJsonLd, webPageJsonLd)
    if (authorJsonLd) entities.push(authorJsonLd)
    if (breadcrumbJsonLd) entities.push(breadcrumbJsonLd)
    for (const extra of extraJsonLd) entities.push(extra)

    if (entities.length === 1) return entities[0] as Record<string, unknown>
    return { '@context': 'https://schema.org', '@graph': entities }
  }

  const headerWechat = headerWechatValues.length ? `
    <div class="header-wechat-inline" aria-label="微信联系方式">
      <span class="header-wechat-icon" aria-hidden="true">💬</span>
      <span class="header-wechat-label">微信联系：</span>
      <span class="header-wechat-list">${headerWechatValues.map((value) => `<span>${escapeHtml(value)}</span>`).join('')}</span>
    </div>` : ''

  const footerContactHtml = footerChannels.length ? `
      <div class="footer-contact-channels" aria-label="联系方式">
        ${footerChannels.map((channel) => {
          const href = channel.openUrl || (channel.type === 'phone' ? `tel:${encodeURIComponent(channel.value)}` : channel.type === 'email' ? `mailto:${encodeURIComponent(channel.value)}` : '')
          const label = `${channel.label || channel.type}: ${channel.value}`
          return href
            ? `<a href="${escapeHtml(href)}" rel="nofollow">${escapeHtml(label)}</a>`
            : `<span>${escapeHtml(label)}</span>`
        }).join(' · ')}
      </div>` : ''

  const desktopNavHtml = desktopNav.map((item) => withSub(item, navLink(item.path, item.label))).join('\n      ')
  const mobileNavHtml = mobileNav.map((item) => withSub(item, navLink(item.path, item.label))).join('\n      ')
  const bottomIcons: Record<string, string> = {
    home: '🏠', services: '🧾', cities: '📍', articles: '📰', about: '🏢', contact: '💬',
  }
  const bottomNavHtml = bottomNav.map((item) =>
    `<a href="${item.path}" class="${navIsActive(item.path) ? 'active' : ''}"${navIsActive(item.path) ? ' aria-current="page"' : ''}><span aria-hidden="true">${bottomIcons[item.key] || '•'}</span>${escapeHtml(item.label)}</a>`
  ).join('\n  ')

  // 可见面包屑：结构化数据必须有对应的可见内容，否则平台会判定为标记滥用。
  const visibleBreadcrumbs = breadcrumbItems.length > 1 ? `
<nav class="breadcrumbs container" aria-label="${escapeHtml(t(locale, 'a11y.breadcrumb'))}">
  <ol>
    ${breadcrumbItems.map((item, index) => {
      const isLast = index === breadcrumbItems.length - 1
      const label = escapeHtml(item.name)
      return isLast
        ? `<li aria-current="page">${label}</li>`
        : `<li><a href="${escapeHtml(item.path)}">${label}</a></li>`
    }).join('')}
  </ol>
</nav>` : ''

  const articleMeta = opts.ogType === 'article' ? `
<meta property="article:published_time" content="${escapeHtml(opts.publishedTime || '')}" />
<meta property="article:modified_time" content="${escapeHtml(opts.modifiedTime || opts.publishedTime || '')}" />` : ''

  return `<!DOCTYPE html>
<html lang="${locale}" data-csp-nonce="${escapeHtml(cspNonce)}">
<head>
<meta charset="UTF-8" />
<meta name="robots" content="${escapeHtml(robots)}" />
<link rel="sitemap" type="application/xml" href="${siteUrl}/sitemap.xml" />
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(siteName)}" href="${siteUrl}/feed.xml" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
${opts.author?.name ? `<meta name="author" content="${escapeHtml(opts.author.name)}" />` : ''}
<meta property="og:locale" content="${ogLocale(locale)}" />
<meta property="og:site_name" content="${escapeHtml(siteName)}" />
<meta name="twitter:card" content="${twitterCard}" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(shareImage)}" />
<meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}" />
<!-- meta keywords 已停用：现代搜索引擎主要依据页面内容、标题、链接和结构化信号判断主题，避免全站关键词堆叠。 -->
<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
${hreflangLinks}
<link rel="describedby" href="${siteUrl}/llms.txt" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:type" content="${opts.ogType || 'website'}" />
<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
<meta property="og:image" content="${escapeHtml(shareImage)}" />
<meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />${articleMeta}
	<link rel="manifest" href="/manifest.json" />
	<meta name="theme-color" content="#1f6fe0" />
	<link rel="apple-touch-icon" href="/icons/icon-192.png" />
	${siteFavicon ? `<link rel="icon" href="${escapeHtml(siteFavicon)}" />` : ''}
	<link rel="stylesheet" href="${STYLESHEET_HREF}" />
	${siteAnalyticsEnabled !== '0' && siteAnalyticsSnippet ? siteAnalyticsSnippet : ''}
		<script type="application/ld+json" nonce="">
${serializeJsonLd(buildJsonLdGraph())}
		</script>
    <a class="logo" href="/">◈ ${escapeHtml(siteName)}</a>
    <nav class="nav" aria-label="${escapeHtml(t(locale, 'a11y.main_nav'))}">
      ${desktopNavHtml}
    </nav>
    <div class="header-tools">
      ${headerWechat}
      ${langSwitcher}
      <button class="header-search-toggle" type="button" aria-label="${escapeHtml(t(locale, 'nav.search_button'))}" aria-expanded="false" aria-controls="headerSearch"><span aria-hidden="true">🔍</span></button>
      <button class="mobile-menu-toggle" type="button" aria-label="${escapeHtml(t(locale, 'a11y.open_nav'))}" aria-expanded="false" aria-controls="mobileNav">☰</button>
    </div>
  </div>
  <div class="header-search-panel" id="headerSearch" hidden>
    <form class="header-search-form" action="/search" method="get" role="search">
      <input name="q" placeholder="${escapeHtml(t(locale, 'nav.search_placeholder'))}" aria-label="${escapeHtml(t(locale, 'nav.search_placeholder'))}" autocomplete="off" />
      <button class="btn" type="submit">${escapeHtml(t(locale, 'nav.search_button'))}</button>
    </form>
  </div>
  <div class="mobile-nav-panel" id="mobileNav" hidden>
    <div class="mobile-nav-head">
      <strong>${escapeHtml(siteName)}</strong>
      <button class="mobile-nav-close" type="button" aria-label="${escapeHtml(t(locale, 'a11y.close_nav'))}">×</button>
    </div>
    <nav class="mobile-nav-list" aria-label="${escapeHtml(t(locale, 'a11y.mobile_nav'))}">
      ${mobileNavHtml}
    </nav>
    <div class="mobile-nav-footer" style="padding:16px;border-top:1px solid var(--border);margin-top:auto">
      ${renderLangSwitcher() ? `<div style="margin-bottom:12px">${renderLangSwitcher()}</div>` : ''}
      ${footerContactHtml ? `<div style="margin-bottom:12px">${footerContactHtml}</div>` : ''}
      <a class="btn" style="width:100;display:block;text-align:center;margin-top:8px" href="/contact">💬 ${escapeHtml(t(locale, 'contact.title'))}</a>
    </div>
  </div>
</header>
<main id="main-content" class="site-main">
${visibleBreadcrumbs}
${body}
</main>
<nav class="bottom-nav" aria-label="${escapeHtml(t(locale, 'a11y.quick_nav'))}">
  ${bottomNavHtml}
  <button class="bottom-nav-more" type="button" aria-controls="mobileNav" aria-expanded="false" aria-label="${escapeHtml(t(locale, 'a11y.more_nav'))}"><span aria-hidden="true">☰</span>${escapeHtml(t(locale, 'nav.more'))}</button>
</nav>
<footer class="footer">
  <div class="container footer-inner">
    <div class="footer-copy">
      <span>${escapeHtml(opts.footerCopyright || (`© ${new Date().getFullYear()} ${siteName}`))}${opts.footerDisclaimer ? ` · ${escapeHtml(opts.footerDisclaimer)}` : ` · ${escapeHtml(t(locale, 'footer.disclaimer'))}`}</span>
      ${opts.footerAiNotice ? `<p class="footer-ai-notice">${escapeHtml(opts.footerAiNotice)}</p>` : ''}
      ${footerContactHtml}
      ${(opts.footerLinks && opts.footerLinks.length) ? `<nav class="footer-links" aria-label="页脚链接">${opts.footerLinks.map((l) => `<a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a>`).join(' · ')}</nav>` : ''}
    </div>
    <a class="footer-contact-link" href="/contact">💬 ${escapeHtml(desktopNav.find((n) => n.key === 'contact')?.label || t(locale, 'contact.title'))}</a>
  </div>
</footer>
	<script src="${MAIN_SCRIPT_HREF}"></script>
${opts.aiQa?.enabled ? renderAiQaWidget(locale, opts.aiQaTurnstileSiteKey || '', cspNonce || '') : ''}
	<!-- 注意：AiQa 问答通过 /api/ai/ask 客户端动态获取，不走服务端渲染。
 * 故其 FAQPage schema（如有）只能在 JS 执行后由客户端注入，AI 爬虫
 * 不执行 JS，此 FAQ 仅对已执行 JS 的环境生效，不影响搜索引擎收录。
 -->
	${renderCtaWidget({
  enabled: opts.siteCtaEnabled !== '0',
  siteName,
  ctaTitle: opts.siteCtaTitle || '联系我们',
  ctaSubtitle: opts.siteCtaSubtitle || '有需求？立即咨询',
  ctaBtnText: opts.siteCtaBtnText || '立即咨询',
  contactChannels: contactChannels || [],
  locale,
})}
</body>
</html>`
}

/**
 * 前台智能问答组件。
 *
 * 几点刻意的设计：
 * - **先问服务端再显示**：渲染时只根据设置输出 DOM，脚本启动后再调
 *   GET /api/ai/qa 确认开关；返回未启用就整块移除。这样后台一关，已缓存的
 *   页面里也不会出现一个点了没反应的按钮。
 * - **不用 innerHTML**：回答与站内来源全部走 textContent / createElement，
 *   模型输出和数据库标题都不进入 HTML 解析路径。
 * - **会话内保留上下文展示**：只做单轮问答（每轮都重新检索），避免多轮对话
 *   把未审核内容或用户隐私带进提示词。
 */
function renderAiQaWidget(locale: Locale, turnstileSiteKey?: string, cspNonce?: string): string {
  const labels = {
    open: t(locale, 'qa.open'),
    title: t(locale, 'qa.title'),
    close: t(locale, 'qa.close'),
    placeholder: t(locale, 'qa.placeholder'),
    send: t(locale, 'qa.send'),
    thinking: t(locale, 'qa.thinking'),
    error: t(locale, 'qa.error'),
    sources: t(locale, 'qa.sources'),
    disclaimer: t(locale, 'qa.disclaimer'),
    reset: locale === 'en' ? 'New chat' : '新对话',
  }
  const configJson = JSON.stringify(labels).replace(/</g, '\\u003c')
  return `
<div id="aiQaRoot" hidden>
  <button class="ai-qa-toggle" type="button" aria-expanded="false" aria-controls="aiQaPanel" aria-label="${escapeHtml(labels.open)}">
    <span aria-hidden="true">💬</span><span class="ai-qa-toggle-text">${escapeHtml(labels.open)}</span>
  </button>
  <section class="ai-qa-panel" id="aiQaPanel" role="dialog" aria-modal="false" aria-label="${escapeHtml(labels.title)}" hidden>
    <header class="ai-qa-head">
      <strong>${escapeHtml(labels.title)}</strong>
      <span class="ai-qa-head-actions">
        <button class="ai-qa-reset" type="button" title="${escapeHtml(labels.reset)}">${escapeHtml(labels.reset)}</button>
        <button class="ai-qa-close" type="button" aria-label="${escapeHtml(labels.close)}">×</button>
      </span>
    </header>
    <div class="ai-qa-log" id="aiQaLog" role="log" aria-live="polite"></div>
    <form class="ai-qa-form" id="aiQaForm">
      <input name="question" maxlength="500" autocomplete="off" placeholder="${escapeHtml(labels.placeholder)}" aria-label="${escapeHtml(labels.placeholder)}" />
      ${turnstileSiteKey ? `<div class="cf-turnstile ai-qa-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" style="margin:8px 0 10px"></div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ''}
      <button class="btn" type="submit">${escapeHtml(labels.send)}</button>
    </form>
    <p class="ai-qa-note">${escapeHtml(labels.disclaimer)}</p>
  </section>
</div>
<script nonce="${cspNonce || ''}">
(() => {
  const ss = document.getElementById('main-stylesheet');
  if (ss && ss.rel === 'preload') ss.rel = 'stylesheet';
  var L = ${configJson};
  var TURNSTILE_SITE_KEY = ${JSON.stringify(turnstileSiteKey)};
  var root = document.getElementById('aiQaRoot');
  if (!root) return;
  var toggle = root.querySelector('.ai-qa-toggle');
  var panel = root.querySelector('.ai-qa-panel');
  var logEl = root.querySelector('.ai-qa-log');
  var form = root.querySelector('.ai-qa-form');
  var input = form && form.querySelector('input[name="question"]');
  var started = false;
  var busy = false;
  var welcomeText = '';

  // 服务端只在问答开启时才输出这段 HTML，所以这里直接显示入口按钮。
  // 旧实现把 root.hidden=false 放在 start() 里，而 start() 只由 toggle 点击触发——
  // toggle 本身就在 hidden 的 root 内，永远点不到，问答窗口因此从不出现。
  root.hidden = false;

  /* 会话键：同一浏览器保持同一段对话，刷新后能回放历史。
     存 localStorage 而不是 cookie，避免每次请求都带上它。 */
  var SESSION_STORE = 'aiQa.session';
  function sessionKey() {
    try {
      var existing = localStorage.getItem(SESSION_STORE);
      if (existing && /^[A-Za-z0-9_-]{8,80}$/.test(existing)) return existing;
      var bytes = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      var key = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      localStorage.setItem(SESSION_STORE, key);
      return key;
    } catch (e) {
      // 隐私模式下 localStorage 可能不可用：退化成"本次页面会话"。
      return 'sess' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
  }

  function bubble(text, cls) {
    var el = document.createElement('div');
    el.className = 'ai-qa-msg ' + (cls || 'ai-qa-msg-bot');
    el.textContent = text;
    logEl.appendChild(el);
    logEl.scrollTop = logEl.scrollHeight;
    return el;
  }

  function withSources(node, sources) {
    if (!sources || !sources.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'ai-qa-sources';
    wrap.appendChild(document.createTextNode(L.sources + '：'));
    sources.forEach(function (s) {
      if (!s || !s.path || !s.title) return;
      var a = document.createElement('a');
      a.href = s.path;
      a.textContent = s.title;
      wrap.appendChild(a);
    });
    node.appendChild(wrap);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { start(); if (input) input.focus(); }
  }

  // 打开后才请求配置，避免每个访客都多一次 API 调用。
  function start() {
    if (started) return;
    started = true;
    fetch('/api/ai/qa', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.ok !== true || data.enabled !== true) { root.remove(); return; }
        root.hidden = false;
        welcomeText = String(data.welcome || '');
        // 先回放同一会话的历史，再补欢迎语——否则刷新后聊天记录会"消失"。
        return fetch('/api/ai/history?session=' + encodeURIComponent(sessionKey()), { headers: { accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (history) {
            var turns = (history && history.turns) || [];
            turns.forEach(function (turn) {
              if (turn.question) bubble(String(turn.question), 'ai-qa-msg-user');
              if (turn.answer) {
                var node = bubble(String(turn.answer), 'ai-qa-msg-bot');
                withSources(node, turn.sources);
              }
            });
            if (!turns.length && data.welcome) bubble(data.welcome, 'ai-qa-msg-bot');
          })
          .catch(function () { if (data.welcome) bubble(data.welcome, 'ai-qa-msg-bot'); });
      })
      .catch(function () { root.remove(); });
  }

  toggle.addEventListener('click', function () { setOpen(panel.hidden); });
  panel.querySelector('.ai-qa-close').addEventListener('click', function () { setOpen(false); });

  // 新对话：换一个会话键并清空气泡，旧会话仍留在后台记录里可查。
  var resetBtn = panel.querySelector('.ai-qa-reset');
  if (resetBtn) resetBtn.addEventListener('click', function () {
    try { localStorage.removeItem(SESSION_STORE); } catch (e) {}
    logEl.innerHTML = '';
    sessionKey();
    if (welcomeText) bubble(welcomeText, 'ai-qa-msg-bot');
    if (input) input.focus();
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy || !input) return;
    var question = String(input.value || '').trim();
    if (!question) return;
    bubble(question, 'ai-qa-msg-user');
    input.value = '';
    busy = true;
    var pending = bubble(L.thinking, 'ai-qa-msg-bot ai-qa-msg-pending');

    // 收集 Turnstile 人机校验令牌（后台配置了密钥时必填，否则 403）。
    var turnstileToken = '';
    if (TURNSTILE_SITE_KEY && window.turnstile) {
      try { turnstileToken = window.turnstile.getResponse() || ''; } catch (e) {}
    }

    fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: question, sessionKey: sessionKey(), 'cf-turnstile-response': turnstileToken }),
    })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        pending.remove();
        if (!res.ok || !res.data || res.data.ok !== true) {
          var msg = (res.data && res.data.error) || L.error;
          // AI 未配置时，服务端已给出具体提示，直接展示，避免静默失败。
          bubble(String(msg), 'ai-qa-msg-bot ai-qa-msg-error');
          return;
        }
        var node = bubble(String(res.data.answer || ''), 'ai-qa-msg-bot');
        withSources(node, res.data.sources);
      })
      .catch(function () {
        pending.remove();
        bubble(L.error, 'ai-qa-msg-bot ai-qa-msg-error');
      })
      .then(function () { busy = false; });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });
})();
</script>`
}

/**
 * 序列化 JSON-LD 供 <script type="application/ld+json"> 内联使用。
 * JSON.stringify 不会转义 `<`，若内容含 `</script>` 会提前闭合脚本块并注入 HTML。
 * 文章标题/FAQ 等可能来自外部采集内容，因此必须转义。
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}


