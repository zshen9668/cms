import { escapeHtml } from './layout'
import { HOME_SECTION_KEYS, parseHomeSectionOrder, type HomeSectionKey, type HomeSectionSlot } from '../utils/homeSectionConfig'
export { HOME_SECTION_KEYS, parseHomeSectionOrder, type HomeSectionKey, type HomeSectionSlot }
import { renderManagedRichText } from './public'
import { t, type Locale } from '../utils/i18n'
import type { ImageStore } from '../utils/imageSettings'
import { renderCaseHomeSection } from './publicCases'
import type { CaseRecord } from '../utils/cases'

export type HomeService = { id: number; name: string; slug: string; icon?: string; summary?: string }
export type HomeArticle = { id: number; title: string; slug: string; summary?: string; content_excerpt?: string; category?: string; [key: string]: unknown }


export const HOME_SECTION_LABELS: Record<HomeSectionKey, string> = {
  intro: '服务内容介绍',
  services: '服务项目',
  cases: '成功案例',
  articles: '新闻资讯',
  contact: '联系引导',
}

export type HomeSectionContext = {
  locale: Locale
  siteName: string
  topic: string
  homeContent: string
  contactNote: string
  contactMessage: string
  images?: ImageStore
  pageLabels: { services: string; cases: string; articles: string }
  services: HomeService[]
  articles: HomeArticle[]
  featuredServices: HomeService[]
  featuredArticles: HomeArticle[]
  /** 首页「成功案例」模块要展示的案例：精选优先，未设精选时回退到排序靠前的案例。 */
  cases: CaseRecord[]
  /** 已发布的案例总数，用于「已交付 N 个项目」与「还有 N 个案例」文案。 */
  caseTotal: number
  contactLinkLabel: string
  articlePublicPath: (item: HomeArticle) => string
  articleListSummary: (item: HomeArticle) => string
}


export function renderIntroSection(ctx: HomeSectionContext): string {
  return `<section class="section home-intro-section" ${!ctx.homeContent ? 'hidden' : ''}>
  <div class="container">
    <article class="home-intro-card">
      <div class="home-intro-heading">
        <span class="home-intro-kicker">${escapeHtml(ctx.locale === 'zh-CN' ? '服务内容介绍' : 'Service information')}</span>
        <h2>${escapeHtml(ctx.topic || ctx.siteName)}</h2>
      </div>
      <div class="page-content-readable managed-content home-intro-content">
        ${ctx.homeContent ? renderManagedRichText(ctx.homeContent) : ''}
      </div>
    </article>
  </div>
</section>`
}

export function renderServicesSection(ctx: HomeSectionContext): string {
  const { locale, images, topic } = ctx
  return `<section class="section container home-services-section" ${!ctx.featuredServices.length ? 'hidden' : ''}>
  <div class="section-title">
    <div>
      <h2>${escapeHtml(ctx.pageLabels.services)}</h2>
      <p class="section-caption">${escapeHtml(topic ? (locale === 'zh-CN' ? '重点' + topic + '服务' : topic + ' services') : (locale === 'zh-CN' ? '当前配置的服务项目' : 'Configured services'))}</p>
    </div>
    <a href="/service">${escapeHtml(t(locale, 'home.services.more'))} →</a>
  </div>
  <ul class="grid grid-3 service-card-grid">
    ${ctx.featuredServices.map((item) => `
      <li><a class="card service-card home-service-card" href="/service/${item.slug}">
        ${images?.services?.[item.slug]?.url ? `<div class="service-card-image"><img src="${escapeHtml(images.services?.[item.slug]?.url || '')}" alt="${escapeHtml(images.services?.[item.slug]?.alt || item.name)}" loading="lazy" width="520" height="220" /></div>` : ''}
        <div class="service-card-body">
          <div class="service-card-top">
            <span class="service-card-icon" aria-hidden="true">${escapeHtml(item.icon || '▦')}</span>
            <span class="service-card-arrow" aria-hidden="true">→</span>
          </div>
          <h3>${escapeHtml(item.name)}</h3>
          ${item.summary ? `<p>${escapeHtml(item.summary.slice(0, 88))}</p>` : ''}
          <span class="service-card-link">${escapeHtml(t(locale, 'common.learn_more'))} →</span>
        </div>
      </a></li>`).join('')}
  </ul>
</section>`
}

/**
 * 首页「成功案例」模块。
 *
 * 这个位置原来展示「服务城市」标签云。城市页 /city/... 仍然存在并进入 sitemap，
 * 只是首页改用一个更能说明交付能力的模块——案例包含项目挑战、解决方案和可验证的成果。
 */
export function renderCasesSection(ctx: HomeSectionContext): string {
  return renderCaseHomeSection({
    cases: ctx.cases,
    locale: ctx.locale,
    total: ctx.caseTotal || ctx.cases.length,
    label: ctx.pageLabels.cases,
  })
}

export function renderArticlesSection(ctx: HomeSectionContext): string {
  const { locale, featuredArticles } = ctx
  return `<section class="section container" ${!featuredArticles.length ? 'hidden' : ''}>
  <div class="section-title">
    <div>
      <h2>${escapeHtml(ctx.pageLabels.articles)}</h2>
      <p class="section-caption">${escapeHtml(locale === 'zh-CN' ? '已发布内容' : 'Published content')}</p>
    </div>
    <a href="/article">${escapeHtml(t(locale, 'home.articles.more'))} →</a>
  </div>
  ${featuredArticles.length ? `<ul class="grid grid-3 home-news-grid">
    ${featuredArticles.map((item) => {
      const date = item.published_at ? String(item.published_at).slice(0, 10) : ''
      return `<li><a class="card article-summary-card" href="${ctx.articlePublicPath(item)}">
        <span class="badge">${escapeHtml(item.category || '资讯')}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(ctx.articleListSummary(item).slice(0, 86))}</p>
        <div class="article-card-meta">${date ? `<span class="article-card-date">${escapeHtml(date)}</span>` : ''}${escapeHtml(t(locale, 'common.learn_more'))} →</div>
      </a></li>`}).join('')}
  </ul>` : `<p style="color:var(--muted)">${escapeHtml(t(locale, 'common.no_data'))}</p>`}
</section>`
}

export function renderContactSection(ctx: HomeSectionContext): string {
  const { locale, topic } = ctx
  return `<section class="section container home-contact-cta">
  <div class="home-contact-cta-card">
    <div>
      <span class="home-contact-cta-kicker">${escapeHtml(locale === 'zh-CN' ? '联系我们' : 'Contact')}</span>
      <h2>${escapeHtml(topic ? (locale === 'zh-CN' ? '需要了解' + topic + '相关信息?' : 'Need information about ' + topic + '?') : (locale === 'zh-CN' ? '需要了解更多信息?' : 'Need more information?'))}</h2>
      <p>${escapeHtml(ctx.contactNote)}</p>
    </div>
    <a class="btn" href="/contact">${escapeHtml(ctx.contactLinkLabel)} →</a>
  </div>
</section>`
}

const SECTION_RENDERERS: Record<HomeSectionKey, (ctx: HomeSectionContext) => string> = {
  intro: renderIntroSection,
  services: renderServicesSection,
  cases: renderCasesSection,
  articles: renderArticlesSection,
  contact: renderContactSection,
}

export function renderHomeSections(order: HomeSectionSlot[], ctx: HomeSectionContext): string {
  const body = order.filter((slot) => slot.visible).map((slot) => SECTION_RENDERERS[slot.key](ctx)).join('\n')
  const message = ctx.contactMessage
    ? `<section class="section container"><p class="contact-success">${escapeHtml(ctx.contactMessage)}</p></section>`
    : ''
  return body + '\n' + message
}
