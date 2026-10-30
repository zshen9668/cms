import { escapeHtml } from './layout'
import { t, pick, type Locale } from '../utils/i18n'
import { parseArticleFaq } from '../utils/articleSchema'
import type { ManagedPage } from '../utils/pageSettings'
import type { AiContentEntry } from '../utils/aiContentStore'
import type { ImageEntry, ImageStore } from '../utils/imageSettings'
import type { PageContactMethods } from '../utils/pageContacts'
import { filterContactChannels, getContactChannelsFromSettings } from '../modules/contactChannels/index'
import { getSiteProfile, type SiteProfile } from '../utils/siteProfile'
import { renderHomeSections, parseHomeSectionOrder } from './homeSections'
import type { CaseRecord } from '../utils/cases'

export type City = { id: number; name: string; slug: string; province?: string }
export type Service = { id: number; name: string; slug: string; icon?: string; summary?: string }
export type Article = { id: number; title: string; slug: string; summary?: string; content_excerpt?: string; category?: string; published_at?: string; city_id?: number }

const AI_RICH_TEXT_TAGS = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'br'])

function articlePublicPath(item: { id: number; slug?: string }): string {
  const key = String(item.slug || '').trim() || String(item.id)
  return '/article/' + encodeURIComponent(key)
}

function articleListSummary(item: Article): string {
  const summary = String(item.summary || '').trim()
  if (summary) return summary.slice(0, 100)
  return String(item.content_excerpt || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

function normalizeArticleKeywords(value: string): string[] {
  return Array.from(new Set(String(value || '').split(/[,，;；、\n]+/).map((v) => v.trim()).filter(Boolean))).slice(0, 5)
}

export function sanitizeAiPublicHtml(value: unknown): string {
  let html = String(value || '')
    .replace(/<(script|style|iframe|object|embed|form|textarea|select)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|textarea|select)[^>]*>/gi, '')
    .replace(/javascript\s*:/gi, '')
    // 历史 AI 采集稿可能已经把“AI辅助/AI生成”声明保存进正文；这些内部生产标记不在前台展示。
    .replace(/本文由\s*AI(?:辅助|生成)[^。！？]{0,120}(?:仅供参考，)?具体以最新官方政策为准[。！？]?/gi, '')
    .replace(/本文由\s*AI(?:辅助|生成)[^。！？]{0,120}(?:仅供参考)[。！？]?/gi, '')
    .replace(/AI\s*图解\s*[·•\-:]?\s*一图看懂/gi, '重点摘要 · 一图看懂')
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (full, tagName) => {
      const tag = String(tagName).toLowerCase()
      if (!AI_RICH_TEXT_TAGS.has(tag)) return ''
      return full.startsWith('</') ? '</' + tag + '>' : '<' + tag + '>'
    })
    // 兜底：上面的正则要求标签以 `>` 闭合，因此形如 `<img src=x onerror=...`（末尾无 `>`）
    // 的残片会原样输出；浏览器会把它与后续模板标签拼成一个可执行标签，必须一并丢弃。
    .replace(/<[a-z][^>]*$/i, '')
    .trim()
  return html.slice(0, 20000)
}

export function sanitizePublicCardSvg(value: unknown): string {
  const raw = String(value || '')
    .slice(0, 50000)
    .replace(/AI\s*图解\s*[·•\-:]?\s*一图看懂/gi, '文章要点')
    .replace(/重点摘要\s*[·•\-:]?\s*一图看懂/gi, '文章要点')
    .replace(/\bAI\s*辅助(?:采集|生成)?\b/gi, '')
    .replace(/>要点1</g, '>核心信息<')
    .replace(/>要点2</g, '>企业影响<')
    .replace(/>要点3</g, '>执行建议<')
    .replace(/>要点4</g, '>风险提醒<')
    .replace(/<\/?(?:script|foreignObject|iframe|object|embed|image|a|style|link|animate|set|use)\b[^>]*>/gi, '')
    .replace(/<\/?(?!svg\b|defs\b|linearGradient\b|stop\b|rect\b|circle\b|text\b|g\b)[a-z][a-z0-9:-]*\b[^>]*>/gi, '')
    .replace(/\s+on[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:href|xlink:href|src|style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+([a-z_:][-a-z0-9_.:]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_full, name, dq, sq, bare) => {
      const allowed = new Set([
        'viewBox','xmlns','font-family','x1','y1','x2','y2','offset','stop-color',
        'width','height','rx','fill','stroke','stroke-width','cx','cy','r','x','y',
        'text-anchor','font-size','font-weight','transform',
      ])
      if (!allowed.has(String(name))) return ''
      const attr = String(dq ?? sq ?? bare ?? '')
      if (/javascript:|vbscript:|data:/i.test(attr)) return ''
      if (/url\(\s*(?!#)[^)]+\)/i.test(attr)) return ''
      return ' ' + name + '="' + attr.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"'
    })
    .replace(/\s{2,}/g, ' ')
    .trim()

  const start = raw.indexOf('<svg')
  const end = raw.lastIndexOf('</svg>')
  if (start < 0 || end < start) return ''
  return raw.slice(start, end + 6).trim()
}

export function renderSafeSvgImage(value: unknown, alt = '文章要点'): string {
  const svg = sanitizePublicCardSvg(value)
  if (!svg) return ''
  return '<img class="article-visual-svg" src="data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg) + '" alt="' + escapeHtml(alt) + '" loading="lazy" decoding="async" />'
}


function normalizeArticleSlides(value: unknown): Array<{ heading: string; text: string }> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, 4).map((item: any, index) => {
      let heading = String(item?.heading || '').trim()
      const text = String(item?.text || '').trim()
      const generic = /^要点(?:\s*)[1-4]?$/.test(heading)
      if (generic || !heading) heading = ['核心信息', '企业影响', '执行建议', '风险提醒'][index] || '文章要点'
      return { heading: heading.slice(0, 30), text: text.slice(0, 180) }
    }).filter((item) => item.text)
  } catch {
    return []
  }
}

export function renderSubprojectTagBar(subprojects: any[], locale: Locale = 'zh-CN'): string {
  if (!subprojects || !subprojects.length) return ''
  const label = locale === 'zh-CN' ? '子项目 / 专题' : 'Topics & subprojects'
  const note = locale === 'zh-CN' ? '按子项目进入独立内容页面。' : 'Open a dedicated page for each topic.'
  return '<section class="section container subproject-tag-section">' +
    '<div class="section-title"><div><h2>' + escapeHtml(label) + '</h2><p class="section-caption">' + escapeHtml(note) + '</p></div></div>' +
    '<nav class="subproject-tag-list" aria-label="子项目">' +
    subprojects.map((item) => '<a class="subproject-tag" href="' + escapeHtml(item.frontend_path || '#') + '">' + escapeHtml(locale === 'zh-CN' ? (item.label_zh || item.name) : (item.label_en || item.label_zh || item.name)) + '</a>').join('') +
    '</nav></section>'
}

export function renderSubprojectPage(params: {
  section: 'service' | 'article' | 'new' | 'city'
  subproject: any
  items: any[]
  locale?: Locale
}): string {
  const section = params.section
  const subproject = params.subproject
  const items = params.items || []
  const locale = params.locale || 'zh-CN'
  const title = locale === 'zh-CN'
    ? (subproject.title_zh || subproject.label_zh || subproject.name)
    : (subproject.title_en || subproject.label_en || subproject.label_zh || subproject.name)
  const subtitle = locale === 'zh-CN' ? subproject.subtitle_zh : subproject.subtitle_en
  const content = locale === 'zh-CN' ? subproject.content_zh : subproject.content_en
  const layout = subproject.layout === 'list' ? 'list' : subproject.layout === 'feature' ? 'feature' : 'grid'
  const sectionLabel = section === 'service'
    ? (locale === 'zh-CN' ? '服务子项目' : 'Service topic')
    : section === 'city'
      ? (locale === 'zh-CN' ? '城市子项目' : 'City topic')
      : section === 'new'
        ? (locale === 'zh-CN' ? '新闻专题' : 'News topic')
        : (locale === 'zh-CN' ? '资讯子项目' : 'Article topic')
  const cards = items.map((item) => {
    const href = section === 'service'
      ? '/service/' + item.slug
      : section === 'city'
        ? '/city/' + item.slug
        : articlePublicPath({ id: Number(item.id || 0), slug: item.slug })
    const name = section === 'service' || section === 'city' ? item.name : item.title
    const summary = item.summary || (section === 'city' ? item.province || '' : '')
    if (layout === 'list') {
      return '<a class="subproject-item subproject-item-list" href="' + escapeHtml(href) + '"><div><strong>' + escapeHtml(name) + '</strong>' +
        (summary ? '<p>' + escapeHtml(String(summary).slice(0, 140)) + '</p>' : '') + '</div><span>→</span></a>'
    }
    return '<li><a class="card subproject-item ' + (layout === 'feature' ? 'subproject-item-feature' : '') + '" href="' + escapeHtml(href) + '">' +
      '<span class="badge">' + escapeHtml(sectionLabel) + '</span><h3>' + escapeHtml(name) + '</h3>' +
      (summary ? '<p>' + escapeHtml(String(summary).slice(0, 140)) + '</p>' : '') +
      '<span class="subproject-item-link">' + escapeHtml(locale === 'zh-CN' ? '查看详情' : 'View details') + ' →</span></a></li>'
  }).join('')
  return '<section class="hero page-heading-hero subproject-hero"><div class="container">' +
    '<span class="article-list-kicker">' + escapeHtml(sectionLabel) + '</span><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(subtitle || '') + '</p></div></section>' +
    (content ? '<section class="section container"><article class="managed-seo-card subproject-content"><div class="page-content-readable">' + renderManagedRichText(content) + '</div></article></section>' : '') +
    '<section class="section container"><div class="section-title"><div><h2>' + escapeHtml(locale === 'zh-CN' ? '本子项目内容' : 'Content in this topic') +
    '</h2><p class="section-caption">' + escapeHtml(locale === 'zh-CN' ? '共 ' + items.length + ' 项' : items.length + ' items') + '</p></div></div>' +
    (items.length ? (layout === 'list' ? '<div class="subproject-list">' + cards + '</div>' : '<ul class="grid grid-3 subproject-grid">' + cards + '</ul>') :
      '<div class="card"><p style="color:var(--muted)">' + escapeHtml(locale === 'zh-CN' ? '这个子项目暂时没有绑定内容。请在后台子项目管理中选择内容。' : 'No content has been assigned to this topic yet.') + '</p></div>') +
    '</section>'
}

export function renderNewList(articles: Article[], subprojects: any[] = [], locale: Locale = 'zh-CN', siteProfile?: SiteProfile): string {
  const topic = siteProfile?.topic || ''
  const heading = topic
    ? (locale === 'zh-CN' ? topic + '新闻专题' : topic + ' news topics')
    : (locale === 'zh-CN' ? '新闻专题' : 'News topics')
  const kicker = topic ? '<div class="article-list-kicker">' + escapeHtml(topic) + '</div>' : ''
  const description = topic
    ? (locale === 'zh-CN' ? '按专题标签浏览当前站点内容。' : 'Browse content grouped by the current site topic.')
    : ''
  return '<section class="hero article-list-hero"><div class="container article-list-hero-inner">' +
    kicker + '<h1>' + escapeHtml(heading) + '</h1>' +
    (description ? '<p>' + escapeHtml(description) + '</p>' : '') + '</div></section>' +
    renderSubprojectTagBar(subprojects, locale) +
    '<section class="section container"><div class="section-title"><div><h2>' + escapeHtml(locale === 'zh-CN' ? '最新资讯' : 'Latest news') + '</h2>' +
    '<p class="section-caption">' + escapeHtml(locale === 'zh-CN' ? '已发布 ' + articles.length + ' 篇' : articles.length + ' published articles') + '</p></div></div>' +
    (articles.length ? '<ul class="grid grid-3 article-card-grid">' + articles.map((item) => '<li><a class="card article-summary-card" href="' + articlePublicPath(item) + '"><span class="badge">' + escapeHtml(item.category || t(locale, 'article.default_category')) +
      '</span><h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(articleListSummary(item)) + '</p><span class="article-summary-link">' +
      escapeHtml(t(locale, 'common.learn_more')) + ' →</span></a></li>').join('') + '</ul>' : '<p style="color:var(--muted)">' + escapeHtml(t(locale, 'common.no_data')) + '</p>') +
    '</section>'
}



function renderArticleVisual(slidesJson: unknown, cardSvg: unknown): string {
  const slides = normalizeArticleSlides(slidesJson)
  if (slides.length) {
    return '<div class="article-insight-grid" aria-label="文章要点">' +
      slides.map((slide, index) => '<div class="article-insight-card">' +
        '<span class="article-insight-index">' + (index + 1) + '</span>' +
        '<div class="article-insight-body"><h3>' + escapeHtml(slide.heading) + '</h3>' +
        '<p>' + escapeHtml(slide.text) + '</p></div></div>').join('') +
      '</div>'
  }
  if (cardSvg) return '<div class="article-visual-fallback" aria-label="文章要点">' + renderSafeSvgImage(cardSvg) + '</div>'
  return ''
}

export function renderManagedRichText(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const cleaned = sanitizeAiPublicHtml(raw)
  if (/<(?:p|h2|h3|ul|ol|li|strong|em|br)\b/i.test(cleaned)) return cleaned
  return escapeHtml(raw)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => '<p>' + part.replace(/\n/g, '<br>') + '</p>')
    .join('')
}


/**
 * 后台页面正文属于 SEO/信息补充，不直接参与首页、服务、城市或资讯列表的主布局。
 * 统一放在页面主体底部，运营编辑正文时不会把卡片和列表整体顶乱。
 */
export function renderManagedSeoSection(
  value: unknown,
  titleZh = '页面服务说明',
  locale: Locale = 'zh-CN',
): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const kicker = pick(locale, '内容与服务说明', 'Content & service notes')
  return `
<section class="section managed-seo-section">
  <div class="container">
    <article class="managed-seo-card">
      <div class="managed-seo-kicker">${escapeHtml(kicker)}</div>
      <h2 class="managed-seo-title">${escapeHtml(titleZh)}</h2>
      <div class="page-content-readable managed-content">${renderManagedRichText(raw)}</div>
    </article>
  </div>
</section>`
}

// 注意：这里只翻译界面上的固定文案（标题、按钮、提示语）。
// 城市名/服务名/文章正文来自数据库（运营者录入或AI采集生成的中文内容），不做机器翻译。
export function renderSearchBox(defaultCity?: string, locale: Locale = 'zh-CN', cities: City[] = []): string {
  const selected = String(defaultCity || '').trim()
  const activeCities = cities.length ? cities : []
  return `<form class="search-box" action="/search" method="get">
  <select name="city">
    <option value="">${escapeHtml(t(locale, 'search.all_cities'))}</option>
    ${activeCities.map((item) => `<option value="${escapeHtml(item.slug)}" ${selected === item.name || selected === item.slug ? 'selected' : ''}>${escapeHtml(item.name)}${locale === 'zh-CN' ? '市' : ''}</option>`).join('')}
  </select>
  <input name="q" placeholder="${escapeHtml(t(locale, 'nav.search_placeholder'))}" />
  <button type="submit">${escapeHtml(t(locale, 'nav.search_button'))}</button>
</form>`
}

export function renderHome(params: {
  cities: City[]; services: Service[]; articles: Article[]; siteName: string;
  homeCases?: CaseRecord[]; caseTotal?: number;
  settings?: Record<string, string>; contactMessage?: string; pageSettings?: Record<string, ManagedPage>; locale?: Locale; images?: ImageStore; pageContact?: PageContactMethods; searchCities?: City[]
}): string {
  const { cities, services, articles, siteName, homeCases = [], caseTotal = 0, settings = {}, contactMessage = '', pageSettings = {}, locale = 'zh-CN', images, searchCities = cities } = params
  const homePage = pageSettings.home
  const siteProfile = getSiteProfile(settings, siteName)
  const homeTitle = locale === 'zh-CN' ? homePage?.titleZh : homePage?.titleEn
  const homeSubtitle = locale === 'zh-CN' ? homePage?.subtitleZh : homePage?.subtitleEn
  const homeContent = (locale === 'zh-CN' ? homePage?.contentZh : homePage?.contentEn) || ''
  const featuredServices = services.slice(0, 8)
  const featuredArticles = articles.slice(0, 6)
  const contactLinkLabel = locale === 'zh-CN' ? '联系我们' : 'Contact us'
  const topic = siteProfile.topic || siteProfile.industry || ''
  const pageLabels = {
    services: locale === 'zh-CN' ? (pageSettings.services?.labelZh || '服务项目') : (pageSettings.services?.labelEn || 'Services'),
    cases: locale === 'zh-CN' ? '成功案例' : 'Case studies',
    articles: locale === 'zh-CN' ? (pageSettings.articles?.labelZh || '新闻资讯') : (pageSettings.articles?.labelEn || 'Insights'),
  }
  const contactNote = locale === 'zh-CN'
    ? '可以提交具体需求或联系方式。'
    : 'Submit a request or contact details for follow-up.'
  return `
<section class="hero page-heading-hero home-hero${images?.home?.url ? ' has-home-image' : ''}">
  ${images?.home?.url ? `<div class="home-hero-bg" aria-hidden="true"><img src="${escapeHtml(images.home.url)}" alt="" loading="eager" width="1600" height="620" /></div>` : ''}
  <div class="container home-hero-inner">
    ${topic ? `<span class="home-hero-kicker">${escapeHtml(topic)}</span>` : ''}
    <h1>${escapeHtml(homeTitle || settings.site_title || siteName || t(locale, 'home.hero.title'))}</h1>
    ${homeSubtitle ? `<p>${escapeHtml(homeSubtitle)}</p>` : ''}
    ${renderSearchBox(undefined, locale, searchCities)}
  </div>
</section>





${renderHomeSections(parseHomeSectionOrder(settings.home_section_order), {
  locale, siteName, topic, homeContent, contactNote, contactMessage, images, pageLabels,
  services, articles, featuredServices, featuredArticles,
  cases: homeCases, caseTotal,
  contactLinkLabel, articlePublicPath, articleListSummary,
})}
`
}


// ---- 城市与文章详情页（保持原有详情模板，不参与列表页版式调整） ----
export function renderCityPage(params: { city: City; services: Service[]; articles: Article[]; locale?: Locale; aiContent?: AiContentEntry; image?: ImageEntry; pageContact?: PageContactMethods; searchCities?: City[]; siteProfile?: SiteProfile }): string {
  const { city, services, articles, aiContent, image, locale = 'zh-CN', searchCities = [], siteProfile } = params
  const topic = siteProfile?.topic || siteProfile?.industry || ''
  return `
<section class="hero page-heading-hero">
  <div class="container">
    <span class="article-list-kicker">${escapeHtml(t(locale, 'nav.cities'))}</span>
    <h1>${escapeHtml(city.name)}${topic ? ' · ' + escapeHtml(topic) : ''}</h1>
    ${(aiContent?.summary || topic) ? `<p>${escapeHtml(aiContent?.summary || pick(locale, '围绕' + city.name + '用户的' + topic + '需求提供相关信息。', 'Relevant ' + topic + ' information for ' + city.name + '.'))}</p>` : ''}
    ${renderSearchBox(city.name, locale, searchCities)}
  </div>
</section>
${(image?.url || aiContent?.content) ? `<section class="section container page-content-section"><div class="card page-content-card">${image?.url ? `<div class="page-content-media"><img src="${escapeHtml(image.url ?? '')}" alt="${escapeHtml(image.alt || city.name)}" loading="lazy" width="1200" height="520" /></div>` : ""}${aiContent?.content ? `<div class="page-content-readable ai-content">${sanitizeAiPublicHtml(aiContent.content)}</div>` : ""}</div></section>` : ""}
<section class="section container">
  <div class="section-title"><div><h2>${escapeHtml(city.name)}${topic ? ' · ' + escapeHtml(topic) : ''}${escapeHtml(locale === 'zh-CN' ? '服务' : ' services')}</h2></div></div>
  <ul class="grid grid-4 service-card-grid">
    ${services.map((s) => `
      <li><a class="card service-card" href="/city/${city.slug}/${s.slug}">
        <div class="service-card-top">
          <span class="service-card-icon" aria-hidden="true">${escapeHtml(s.icon || '▦')}</span>
          <span class="service-card-arrow" aria-hidden="true">→</span>
        </div>
        <h3>${escapeHtml(s.name)}</h3>
        ${s.summary ? `<p>${escapeHtml(s.summary.slice(0, 100))}</p>` : ''}
        <span class="service-card-link">${escapeHtml(t(locale, 'common.learn_more'))} →</span>
      </a></li>`).join('')}
  </ul>
</section>
<section class="section container">
  <div class="section-title"><div><h2>${escapeHtml(city.name)}${escapeHtml(locale === 'zh-CN' ? '相关资讯' : ' related articles')}</h2></div></div>
  ${articles.length ? `<ul class="grid grid-3 article-card-grid">
    ${articles.map((a) => `
      <li><a class="card article-summary-card" href="${articlePublicPath(a)}">
        <span class="badge">${escapeHtml(a.category || t(locale, 'article.default_category'))}</span>
        <h3>${escapeHtml(a.title)}</h3>
        <p>${escapeHtml((a.summary || '').slice(0, 100))}</p>
        <span class="article-summary-link">${escapeHtml(t(locale, 'common.learn_more'))} →</span>
      </a></li>`).join('')}
  </ul>` : `<p style="color:var(--muted)">${escapeHtml(t(locale, 'common.no_data'))}</p>`}
</section>
`
}
export function renderCityServicePage(params: { city: City; service: Service; locale?: Locale; aiContent?: AiContentEntry; image?: ImageEntry; pageContact?: PageContactMethods; relatedArticles?: Article[]; siteProfile?: SiteProfile }): string {
  const { city, service, aiContent, image, locale = 'zh-CN', relatedArticles = [], siteProfile } = params
  const topic = siteProfile?.topic || siteProfile?.industry || ''
  const heroMeta = [service.summary || '', topic].filter(Boolean).join(' · ')
  return `
<section class="hero page-heading-hero">
  <div class="container">
    <h1>${escapeHtml(city.name)}${escapeHtml(service.name)}</h1>
    ${heroMeta ? `<p>${escapeHtml(heroMeta)}</p>` : ''}
  </div>
</section>
${(image?.url || aiContent?.content) ? `<section class="section container page-content-section"><div class="card page-content-card">${image?.url ? `<div class="page-content-media"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || city.name + service.name)}" loading="lazy" width="1200" height="520" /></div>` : ""}${aiContent?.content ? `<div class="page-content-readable ai-content">${sanitizeAiPublicHtml(aiContent.content)}</div>` : ""}</div></section>` : ""}
${relatedArticles.length ? '<section class="section container"><div class="section-title"><h2>' + escapeHtml(locale === 'zh-CN' ? '相关资讯' : 'Related articles') + '</h2></div><ul class="grid grid-3">' + relatedArticles.map((a) => '<li><a class="card article-summary-card" href="' + articlePublicPath(a) + '"><span class="badge">' + escapeHtml(a.category || t(locale, 'article.default_category')) + '</span><h3>' + escapeHtml(a.title) + '</h3><p>' + escapeHtml((a.summary || '').slice(0, 90)) + '</p><span class="article-summary-link">' + escapeHtml(locale === 'zh-CN' ? '查看详情' : 'View details') + ' →</span></a></li>').join('') + '</ul></section>' : ''}
`
}



/**
 * 把数据库里的时间字符串转成合法 <time datetime> 值。
 * SQLite 的 datetime('now') 产出 "YYYY-MM-DD HH:MM:SS"，HTML 需要 "YYYY-MM-DDTHH:MM:SS"。
 * 无法识别的格式返回空串，调用方据此省略 datetime 属性（不要输出非法值）。
 */
export function toDateTimeAttr(value: unknown): string {
  const raw = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw.replace(' ', 'T')
  return ''
}

/**
 * 可见 FAQ 区块。
 *
 * 旧版本只把 faq_json 输出成 FAQPage 结构化数据，页面里看不到任何问答内容。
 * Google 明确要求结构化数据必须有对应的可见内容，否则判定为标记滥用并可能取消富结果。
 * 这里把同一批数据渲染成真实可见的问答，两者必须同时存在。
 */
export function renderArticleFaq(faqJson: unknown, locale: Locale = 'zh-CN'): string {
  const items = parseArticleFaq(faqJson)
  if (!items.length) return ''
  return `
  <section class="article-faq" aria-labelledby="article-faq-title">
    <h2 id="article-faq-title">${escapeHtml(t(locale, 'article.faq_title'))}</h2>
    <div class="article-faq-list">
      ${items.map((item) => `<div class="article-faq-item"><h3>${escapeHtml(item.q)}</h3><p>${escapeHtml(item.a)}</p></div>`).join('')}
    </div>
  </section>`
}

export type ArticleAuthorInput = {
  name: string
  url?: string
  jobTitle?: string
  credentials?: string
  knowsAbout?: string[]
}

export function renderArticlePage(a: {
  title: string; summary?: string; content: string; seo_keywords?: string; category?: string; source_name?: string; source_url?: string
  published_at?: string; updated_at?: string
  card_svg?: string; slides_json?: string; ai_generated?: number; cover_image?: string
  faq_json?: string
  author?: ArticleAuthorInput
}, locale: Locale): string {
  const summary = String(a.summary || '').trim()
  void locale
  const keywords = normalizeArticleKeywords(a.seo_keywords || '')
  const published = String(a.published_at || '').trim()
  const updated = String(a.updated_at || '').trim()
  const publishedAttr = toDateTimeAttr(published)
  const updatedAttr = toDateTimeAttr(updated)
  const cover = String(a.cover_image || '').trim()
  const coverOk = cover.startsWith('/media/') || cover.startsWith('https://') || cover.startsWith('http://')
  const showUpdated = Boolean(updatedAttr && updatedAttr !== publishedAttr)
  const faqHtml = renderArticleFaq(a.faq_json, locale)

  // 文章元信息：<time> 是 AI 引擎判断内容新鲜度的主要依据，必须用语义标签而不是纯文本。
  // 中英文用不同的冒号习惯（中文全角「：」，英文「: 」）。
  const label = (key: string): string => t(locale, key) + pick(locale, '：', ': ')
  const metaParts: string[] = []
  if (published) {
    metaParts.push(publishedAttr ? `<time datetime="${escapeHtml(publishedAttr)}">${escapeHtml(label('article.published_at'))}${escapeHtml(published)}</time>` : `${escapeHtml(label('article.published_at'))}${escapeHtml(published)}`)
  }
  if (showUpdated) {
    metaParts.push(updatedAttr ? `<time datetime="${escapeHtml(updatedAttr)}">${escapeHtml(label('article.updated_at'))}${escapeHtml(updated)}</time>` : `${escapeHtml(label('article.updated_at'))}${escapeHtml(updated)}`)
  }
  if (a.author?.name) {
    const authorLabel = a.author.credentials
      ? `${a.author.name}（${a.author.credentials}）`
      : a.author.name
    metaParts.push(escapeHtml(label('article.author')) + escapeHtml(authorLabel))
  }
  if (a.source_name) metaParts.push(escapeHtml(label('article.source')) + escapeHtml(a.source_name))

  return `
<section class="hero page-heading-hero">
  <div class="container page-heading-hero-inner">
    <span class="article-list-kicker">${escapeHtml(a.category || t(locale, 'article.default_category'))}</span>
    <h1>${escapeHtml(a.title)}</h1>
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
    ${coverOk ? `<figure class="article-cover-wrap"><img class="article-cover-image" src="${escapeHtml(cover)}" alt="${escapeHtml(a.title)}" loading="eager" decoding="async" width="1200" height="630" /></figure>` : ''}
    ${metaParts.length ? `<p class="article-meta">${metaParts.join(' · ')}</p>` : ''}
    ${keywords.length ? `<ul class="city-tags">${keywords.map((keyword) => `<li><span class="city-tag">${escapeHtml(keyword)}</span></li>`).join('')}</ul>` : ''}
  </div>
</section>
<section class="section container">
  <article class="page-content-card">
    <div class="page-content-readable article-content">${sanitizeAiPublicHtml(a.content)}</div>
    ${faqHtml}
    ${a.source_url ? `<p class="article-source-note">${escapeHtml(t(locale, 'article.original_link'))}：<a href="${escapeHtml(a.source_url)}" target="_blank" rel="nofollow noopener">${escapeHtml(a.source_name || t(locale, 'article.source_link'))}</a></p>` : ''}
  </article>
</section>
`
}


export function renderArticleList(articles: Article[], locale: Locale = 'zh-CN', page?: ManagedPage, subprojects: any[] = [], siteProfile?: SiteProfile): string {
  const title = locale === 'zh-CN' ? page?.titleZh : page?.titleEn
  const subtitle = locale === 'zh-CN' ? page?.subtitleZh : page?.subtitleEn
  const content = locale === 'zh-CN' ? page?.contentZh : page?.contentEn
  return `
<section class="hero page-heading-hero">
  <div class="container page-heading-hero-inner">
    ${siteProfile?.topic ? `<span class="article-list-kicker">${escapeHtml(siteProfile.topic)}</span>` : ''}
    <h1>${escapeHtml(title || t(locale, 'home.articles.title'))}</h1>
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
  </div>
</section>

<section class="section container">
  <div class="section-title">
    <div>
      <h2>${escapeHtml(page?.[locale === 'zh-CN' ? 'labelZh' : 'labelEn'] || (locale === 'zh-CN' ? '新闻资讯' : 'Insights'))}</h2>
      <p class="section-caption">${escapeHtml(locale === 'zh-CN' ? `已发布 ${articles.length} 篇` : `${articles.length} published articles`)}</p>
    </div>
  </div>
  ${articles.length ? `<ul class="grid grid-3 article-card-grid">
    ${articles.map((item) => `
      <li><a class="card article-summary-card" href="${articlePublicPath(item)}">
        <span class="badge">${escapeHtml(item.category || t(locale, 'article.default_category'))}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml((item.summary || '').slice(0, 100))}</p>
        <span class="article-summary-link">${escapeHtml(t(locale, 'common.learn_more'))} →</span>
      </a></li>`).join('')}
  </ul>` : `<p style="color:var(--muted)">${escapeHtml(t(locale, 'common.no_data'))}</p>`}
</section>

${renderSubprojectTagBar(subprojects, locale)}
${renderManagedSeoSection(content, pick(locale, '资讯说明', 'About our insights'), locale)}
`
}


export function renderServiceList(
  services: Service[],
  locale: Locale = 'zh-CN',
  externalLinks: Record<string, string> = {},
  page?: ManagedPage,
  subprojects: any[] = [],
  images?: ImageStore,
): string {
  const title = locale === 'zh-CN' ? page?.titleZh : page?.titleEn
  const subtitle = locale === 'zh-CN' ? page?.subtitleZh : page?.subtitleEn
  const content = locale === 'zh-CN' ? page?.contentZh : page?.contentEn
  void subprojects
  return `
<section class="hero page-heading-hero">
  <div class="container">
    <span class="article-list-kicker">${escapeHtml(t(locale, 'nav.services'))}</span>
    <h1>${escapeHtml(title || t(locale, 'service.list_title'))}</h1>
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
  </div>
</section>

<section class="section container">
  <div class="section-title">
    <div>
      <h2>${escapeHtml(page?.[locale === 'zh-CN' ? 'labelZh' : 'labelEn'] || (locale === 'zh-CN' ? '服务项目' : 'Services'))}</h2>
      <p class="section-caption">${escapeHtml(locale === 'zh-CN' ? `共 ${services.length} 项` : `${services.length} services`)}</p>
    </div>
  </div>
  <ul class="grid grid-3 service-card-grid">
    ${services.map((item) => `
      <li><a class="card service-card" href="${escapeHtml(externalLinks[item.slug] || ('/service/' + item.slug))}"${externalLinks[item.slug] ? ' target="_blank" rel="noopener noreferrer"' : ''}>
        ${images?.services?.[item.slug]?.url ? `<div class="service-card-image"><img src="${escapeHtml(images.services?.[item.slug]?.url || '')}" alt="${escapeHtml(images.services?.[item.slug]?.alt || item.name)}" loading="lazy" width="520" height="220" /></div>` : ''}
        <div class="service-card-top">
          <span class="service-card-icon" aria-hidden="true">${escapeHtml(item.icon || '▦')}</span>
          <span class="service-card-arrow" aria-hidden="true">→</span>
        </div>
        <h3>${escapeHtml(item.name)}</h3>
         ${item.summary ? `<p>${escapeHtml(item.summary.slice(0, 100))}</p>` : ''}
        <span class="service-card-link">${escapeHtml(t(locale, 'common.learn_more'))} →</span>
      </a></li>`).join('')}
  </ul>
</section>

${renderManagedSeoSection(content, pick(locale, '服务项目说明', 'About our services'), locale)}
`
}


export function renderServiceDetail(params: { service: Service; cities: City[]; locale?: Locale; aiContent?: AiContentEntry; image?: ImageEntry; pageContact?: PageContactMethods; relatedArticles?: Article[]; siteProfile?: SiteProfile }): string {
  const { service, cities, aiContent, image, locale = 'zh-CN', relatedArticles = [], siteProfile } = params
  const topic = siteProfile?.topic || siteProfile?.industry || ''
  const heroMeta = [aiContent?.summary || service.summary || '', topic].filter(Boolean).join(' · ')
  return `
<section class="hero page-heading-hero">
  <div class="container">
    <span class="article-list-kicker">${escapeHtml(t(locale, 'nav.services'))}</span>
    <h1>${escapeHtml(service.name)}</h1>
    ${heroMeta ? `<p>${escapeHtml(heroMeta)}</p>` : ''}
    ${renderSearchBox(undefined, locale, cities)}
  </div>
</section>
${(image?.url || aiContent?.content) ? `<section class="section container page-content-section"><div class="card page-content-card">${image?.url ? `<div class="page-content-media"><img src="${escapeHtml(image.url ?? '')}" alt="${escapeHtml(image.alt || service.name)}" loading="lazy" width="1200" height="520" /></div>` : ""}${aiContent?.content ? `<div class="page-content-readable ai-content">${sanitizeAiPublicHtml(aiContent.content)}</div>` : ""}</div></section>` : ""}
<section class="section container">
  <div class="section-title"><h2>${escapeHtml(locale === 'zh-CN' ? '选择所在地区' : 'Choose a service area')}</h2></div>
  <ul class="city-tags">
    ${cities.map((item) => `<li><a class="city-tag" href="/city/${item.slug}/${service.slug}">${escapeHtml(item.name)}${escapeHtml(service.name)}</a></li>`).join('')}
  </ul>
</section>
<section class="section container">
  <div class="card">
    <h3>${escapeHtml(t(locale, 'service.why_us'))}：${escapeHtml(service.name)}</h3>
    <p>${escapeHtml(topic
      ? (locale === 'zh-CN' ? '围绕' + topic + '提供专业信息，包含适用场景、办理路径、注意事项和下一步行动。' : 'Practical ' + topic + ' information covering use cases, next steps, key notes and actions.')
      : (locale === 'zh-CN' ? '这里显示当前服务的公开说明、适用场景、办理路径、注意事项和下一步行动。' : 'This area provides the current service description, use cases, next steps, key notes and actions.'))}</p>
  </div>
</section>
${relatedArticles.length ? '<section class="section container"><div class="section-title"><h2>' + escapeHtml(locale === 'zh-CN' ? '最新相关资讯' : 'Latest related articles') + '</h2></div><ul class="grid grid-3">' + relatedArticles.map((a) => '<li><a class="card article-summary-card" href="' + articlePublicPath(a) + '"><span class="badge">' + escapeHtml(a.category || t(locale, 'article.default_category')) + '</span><h3>' + escapeHtml(a.title) + '</h3><p>' + escapeHtml((a.summary || '').slice(0, 90)) + '</p><span class="article-summary-link">' + escapeHtml(locale === 'zh-CN' ? '查看详情' : 'View details') + ' →</span></a></li>').join('') + '</ul></section>' : ''}
`
}



// ---- 城市列表页 /city
export function renderCityList(cities: City[], locale: Locale = 'zh-CN', page?: ManagedPage, subprojects: any[] = [], images?: ImageStore): string {
  const title = locale === 'zh-CN' ? page?.titleZh : page?.titleEn
  const subtitle = locale === 'zh-CN' ? page?.subtitleZh : page?.subtitleEn
  const content = locale === 'zh-CN' ? page?.contentZh : page?.contentEn
  return `
<section class="hero page-heading-hero">
  <div class="container">
    <span class="article-list-kicker">${escapeHtml(t(locale, 'nav.cities'))}</span>
    <h1>${escapeHtml(title || t(locale, 'city.list_title'))}</h1>
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
  </div>
</section>

<section class="section container">
  <div class="section-title">
    <div>
      <h2>${escapeHtml(page?.[locale === 'zh-CN' ? 'labelZh' : 'labelEn'] || (locale === 'zh-CN' ? '服务城市' : 'Cities'))}</h2>
      <p class="section-caption">${escapeHtml(locale === 'zh-CN' ? `当前展示 ${cities.length} 个城市` : `${cities.length} cities are available`)}</p>
    </div>
  </div>
  <ul class="city-list-grid">
    ${cities.map((item) => `<li><a class="city-tag city-list-card" href="/city/${item.slug}">
      ${images?.cities?.[item.slug]?.url ? `<img src="${escapeHtml(images.cities?.[item.slug]?.url || '')}" alt="${escapeHtml(images.cities?.[item.slug]?.alt || item.name)}" loading="lazy" width="520" height="220" />` : ''}
      <span class="city-list-card-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.province || '')}</small></span>
      <span class="city-list-card-link">${escapeHtml(locale === 'zh-CN' ? '查看服务' : 'View services')} →</span>
    </a></li>`).join('')}
  </ul>
</section>

${renderSubprojectTagBar(subprojects)}
${renderManagedSeoSection(content, pick(locale, '城市服务说明', 'About our service areas'), locale)}
`
}


export function renderAboutPage(settings: Record<string, string>, siteName: string, locale: Locale = 'zh-CN', page?: ManagedPage): string {
  const aboutTitle = locale === 'zh-CN' ? page?.titleZh : page?.titleEn
  void siteName
  const aboutSubtitle = locale === 'zh-CN' ? page?.subtitleZh : page?.subtitleEn
  const aboutContent = locale === 'zh-CN' ? page?.contentZh : page?.contentEn
  return `
<section class="hero page-heading-hero">
  <div class="container">
    <span class="article-list-kicker">${escapeHtml(t(locale, 'nav.about'))}</span>
    <h1>${escapeHtml(aboutTitle || t(locale, 'about.title'))}</h1>
    ${aboutSubtitle || settings.site_description ? `<p>${escapeHtml(String(aboutSubtitle ?? settings.site_description ?? ''))}</p>` : ''}
  </div>
</section>

<section class="section container about-columns">
  <div class="about-main">
    ${renderManagedSeoSection(aboutContent, pick(locale, '关于我们', 'About us'), locale)}
  </div>
  <aside class="about-side">
    <div class="card about-card" style="margin-bottom:16px">
      <h3 style="margin:0 0 10px">${escapeHtml(pick(locale, '服务优势', 'Why choose us'))}</h3>
      <ul class="about-list">
        <li><strong>${escapeHtml(pick(locale, '专业团队', 'Experienced team'))}</strong><span>${escapeHtml(pick(locale, '多年行业服务经验，了解本地企业需求。', 'Years of industry experience with local business needs.'))}</span></li>
        <li><strong>${escapeHtml(pick(locale, '快速响应', 'Fast response'))}</strong><span>${escapeHtml(pick(locale, '7×12 小时在线支持，及时解答您的问题。', 'Online support 7×12 to answer your questions quickly.'))}</span></li>
        <li><strong>${escapeHtml(pick(locale, '透明报价', 'Transparent pricing'))}</strong><span>${escapeHtml(pick(locale, '无隐藏收费，服务内容与费用清晰明确。', 'No hidden fees; scope and cost are clearly stated.'))}</span></li>
      </ul>
    </div>
    <div class="card about-card">
      <h3 style="margin:0 0 10px">${escapeHtml(pick(locale, '团队介绍', 'Our team'))}</h3>
      <p style="color:var(--muted);font-size:13px;line-height:1.7;margin:0">${escapeHtml(pick(locale, '我们由资深顾问、项目经理和技术专家组成，致力于为每个客户交付可验证的业务成果。', 'Our consultants, project managers and technical experts focus on delivering measurable results for every client.'))}</p>
    </div>
  </aside>
</section>
`
}



/**
 * 公开留言表单（姓名/电话/邮箱/城市/需求 + 蜜罐 + Turnstile），提交到 POST /contact。
 *
 * 抽成独立函数是因为它现在有两个使用场景：
 * 1. /contact 页面右侧的需求表单；
 * 2. 列表页（如 /case）在「前台显示留言表单」打开时追加的表单区块。
 * 两处字段、蜜罐与验证码完全一致，避免表单行为出现两套实现。
 */
export function renderContactFormBlock(opts: { locale?: Locale; turnstileSiteKey?: string; heading?: string; note?: string } = {}): string {
  const locale = opts.locale || 'zh-CN'
  const turnstileSiteKey = String(opts.turnstileSiteKey || '').trim()
  const turnstileBlock = turnstileSiteKey ? `
    <div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" style="margin:8px 0 14px"></div>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
` : ''
  const heading = opts.heading || (locale === 'zh-CN' ? '留下需求' : 'Send a request')
  const note = opts.note || (locale === 'zh-CN' ? '我们会根据你填写的信息尽快联系。' : 'We will use your information to follow up.')
  return `<form class="contact-form" method="post" action="/contact">
      <div class="contact-form-heading">
        <h2>${escapeHtml(heading)}</h2>
        <p>${escapeHtml(note)}</p>
      </div>
      <label>${escapeHtml(t(locale, 'contact.name'))}
        <input name="name" maxlength="100" autocomplete="name" />
      </label>
      <label>${escapeHtml(t(locale, 'contact.phone'))} <span aria-hidden="true">*</span>
        <input name="phone" maxlength="50" autocomplete="tel" inputmode="tel" required />
      </label>
      <label>${escapeHtml(locale === 'zh-CN' ? '邮箱' : 'Email')}<input type="email" name="email" maxlength="254" autocomplete="email" /></label>
      <label>${escapeHtml(t(locale, 'contact.city'))}
        <input name="city" maxlength="100" />
      </label>
      <label>${escapeHtml(t(locale, 'contact.service'))}
        <input name="service" maxlength="100" />
      </label>
      <label>${escapeHtml(t(locale, 'contact.message'))}
        <textarea name="content" maxlength="2000" rows="5"></textarea>
      </label>
      <div style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden" aria-hidden="true">
        <label>website<input name="website" tabindex="-1" autocomplete="off" /></label>
      </div>
      <input type="hidden" name="utm_source" />
      <input type="hidden" name="utm_medium" />
      <input type="hidden" name="utm_campaign" />
      <input type="hidden" name="utm_term" />
      <input type="hidden" name="utm_content" />
      <button class="btn" type="submit">${escapeHtml(t(locale, 'contact.submit'))}</button>
    </form>
    <script>
    (function(){      const params = new URLSearchParams(location.search);      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function(key){        var v = params.get(key);        if (v) {          var el = document.querySelector('input[name="'+key+'"]');          if (el) el.value = v;
        }      });
    })();
    </script>`
}

/** 404 页面正文。 */
export function render404Page(path: string, locale: Locale): string {
  const title = locale === 'zh-CN' ? '页面不存在' : 'Page not found'
  const hint = locale === 'zh-CN'
    ? '你访问的页面不存在或已被移除，可以返回首页或使用下方搜索查找内容。'
    : 'The page you are looking for does not exist or has been removed. Go back to the homepage or use search below.'
  return `
<section class="hero page-heading-hero">
  <div class="container">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(hint)}</p>
    <p style="color:var(--muted);font-size:13px">路径：${escapeHtml(path)}</p>
    <a class="btn" href="/">🏠 ${locale === 'zh-CN' ? '返回首页' : 'Go to homepage'}</a>
    ${renderSearchBox(undefined, locale)}
  </div>
</section>`
}

/** 联系我们页面正文。 */
export function renderContactPage(
  settings: Record<string, string>,
  locale: Locale,
  message: string,
  contactPage?: ManagedPage,
  pageContact?: any,
): string {
  const title = (locale === 'zh-CN' ? contactPage?.titleZh : contactPage?.titleEn) || t(locale, 'contact.title')
  const subtitle = (locale === 'zh-CN' ? contactPage?.subtitleZh : contactPage?.subtitleEn) || t(locale, 'contact.subtitle')
  const content = (locale === 'zh-CN' ? contactPage?.contentZh : contactPage?.contentEn) || ''
  return `
<section class="hero page-heading-hero">
  <div class="container">
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
  </div>
</section>
<section class="section container contact-page">
  <div class="contact-columns">
    <div class="contact-main">
      ${content ? `<div class="page-content-readable">${renderManagedRichText(content)}</div>` : ''}
      ${renderContactFormBlock({ locale, heading: t(locale, 'contact.heading'), note: t(locale, 'contact.note') })}
    </div>
    <div class="contact-side">
      ${pageContact && (pageContact.phones.length || pageContact.wechats.length || pageContact.qqs.length)
        ? `<div class="card contact-card"><h3>${locale === 'zh-CN' ? '联系方式' : 'Contact'}</h3>
           ${pageContact.phones.map((p: string) => `<p>📞 ${escapeHtml(p)}</p>`).join('')}
           ${pageContact.wechats.map((w: string) => `<p>💬 ${escapeHtml(w)}</p>`).join('')}
           ${pageContact.qqs.map((q: string) => `<p>QQ ${escapeHtml(q)}</p>`).join('')}
         </div>` : ''}
    </div>
  </div>
</section>`
}

/** 搜索结果页面正文。 */
export function renderSearchResults(params: {
  q: string; cities: any[]; services: any[]; articles: any[]; locale: Locale
}): string {
  const { q, cities, services, articles, locale } = params
  const total = cities.length + services.length + articles.length
  const heading = `"${escapeHtml(q)}"` + (locale === 'zh-CN' ? ' 的搜索结果' : ' search results')
  return `
<section class="hero page-heading-hero">
  <div class="container">
    <h1>${heading}</h1>
    <p style="color:var(--muted);font-size:13px">${locale === 'zh-CN' ? `共找到 ${total} 条结果` : `${total} results found`}</p>
    ${renderSearchBox(q, locale, cities)}
  </div>
</section>
<section class="section container">
  ${cities.length ? `<div class="section-title"><h2>${locale === 'zh-CN' ? '城市' : 'Cities'}</h2></div>
  <ul class="city-list-grid">${cities.map((item) => `<li><a class="city-tag city-list-card" href="/city/${item.slug}">
    <span class="city-list-card-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.province || '')}</small></span>
    <span class="city-list-card-link">${locale === 'zh-CN' ? '查看服务' : 'View services'} →</span>
  </a></li>`).join('')}</ul>` : ''}
  ${services.length ? `<div class="section-title"><h2>${locale === 'zh-CN' ? '服务' : 'Services'}</h2></div>
  <ul class="grid grid-3 service-card-grid">${services.map((item) => `<li><a class="card service-card" href="/service/${item.slug}">
    <div class="service-card-top"><span class="service-card-icon" aria-hidden="true">▦</span><span class="service-card-arrow" aria-hidden="true">→</span></div>
    <h3>${escapeHtml(item.name)}</h3><span class="service-card-link">${locale === 'zh-CN' ? '查看详情' : 'View details'} →</span>
  </a></li>`).join('')}</ul>` : ''}
  ${articles.length ? `<div class="section-title"><h2>${locale === 'zh-CN' ? '资讯' : 'Insights'}</h2></div>
  <ul class="grid grid-3 article-card-grid">${articles.map((item: any) => `<li><a class="card article-summary-card" href="/article/${item.slug || item.id}">
    <span class="badge">${escapeHtml(item.category || '')}</span>
    <h3>${escapeHtml(item.title)}</h3><p>${escapeHtml((item.summary || '').slice(0, 100))}</p>
    <span class="article-summary-link">${locale === 'zh-CN' ? '查看详情' : 'View details'} →</span>
  </a></li>`).join('')}</ul>` : ''}
  ${total === 0 ? `<p style="color:var(--muted)">${locale === 'zh-CN' ? '没有找到匹配的结果。' : 'No matching results found.'}</p>` : ''}
</section>`
}

