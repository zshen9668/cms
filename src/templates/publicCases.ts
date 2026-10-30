import { escapeHtml } from './layout'
import { renderManagedRichText, renderManagedSeoSection } from './public'
import { caseDisplayTitle, parseCaseResults, casePublicPath, type CaseRecord } from '../utils/cases'
import type { ManagedPage } from '../utils/pageSettings'
import type { Locale } from '../utils/i18n'
import { t } from '../utils/i18n'

/**
 * 成功案例前台模板。
 *
 * 版式目标：整洁、清楚、不复杂——一屏之内看清「谁、做了什么、结果如何」，
 * 详情页按「成果 → 挑战 → 方案 → 正文 → 客户评价」的阅读顺序展开。
 */

function zh(locale: Locale, chinese: string, english: string): string {
  return locale === 'zh-CN' ? chinese : english
}

function metaLine(row: CaseRecord, locale: Locale): string {
  const parts = [row.industry, row.service_name, row.region].map((v) => String(v || '').trim()).filter(Boolean)
  if (!parts.length) return ''
  return `<p class="case-meta">${parts.map((p) => `<span>${escapeHtml(p)}</span>`).join('')}</p>`
}

function coverImage(row: CaseRecord, locale: Locale, width: number, height: number): string {
  const url = String(row.cover_image_url || '').trim()
  if (!url) return ''
  const alt = [caseDisplayTitle(row), zh(locale, '项目配图', 'Project image')].filter(Boolean).join(' ')
  return `<div class="case-cover"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" width="${width}" height="${height}" /></div>`
}

/** 列表卡片：优先展示第一条成果数据，它比摘要更能说明交付价值。 */
function caseCard(row: CaseRecord, locale: Locale): string {
  const results = parseCaseResults(row.results)
  const title = caseDisplayTitle(row)
  const lead = String(row.summary || '').trim()
  const highlight = results[0] || ''
  return `<li><a class="card case-card" href="${escapeHtml(casePublicPath(row.slug))}">
    ${coverImage(row, locale, 520, 300)}
    <div class="case-card-body">
      ${row.industry ? `<span class="badge">${escapeHtml(row.industry)}</span>` : ''}
      <h3>${escapeHtml(title)}</h3>
      ${lead ? `<p>${escapeHtml(lead.slice(0, 96))}</p>` : ''}
      ${highlight ? `<p class="case-highlight">${escapeHtml(highlight.slice(0, 60))}</p>` : ''}
      <span class="case-card-link">${escapeHtml(zh(locale, '查看案例', 'Read the case'))} →</span>
    </div>
  </a></li>`
}

/**
 * 案例列表页 /case。
 *
 * 与 /service、/city、/article 保持一致：页面标题走 hero 的 h1，副标题走 hero 的 p，
 * 「前台页面」里填写的补充正文走底部固定内容区。
 * 之前标题被当成区块小标题(h2)、正文直接插在卡片上方，运营在后台改了标题/副标题/正文
 * 在前台几乎看不出变化——现在三者都落在和其他受管列表页相同的位置。
 * 「前台显示留言表单」开关（默认开）控制是否追加留言表单区块。
 */
export function renderCaseList(
  cases: CaseRecord[],
  locale: Locale,
  page?: ManagedPage,
  opts: { turnstileSiteKey?: string; industries?: string[]; currentIndustry?: string } = {},
): string {
  const chinese = locale === 'zh-CN'
  const title = (chinese ? page?.titleZh : page?.titleEn)
    || (chinese ? page?.labelZh : page?.labelEn)
    || zh(locale, '成功案例', 'Case studies')
  const subtitle = (chinese ? page?.subtitleZh : page?.subtitleEn)
    || zh(locale, '真实交付的项目、遇到的问题与最终成果。', 'Real projects, the problems we solved, and the results.')
  const label = (chinese ? page?.labelZh : page?.labelEn) || zh(locale, '成功案例', 'Case studies')
  const pageContent = String((chinese ? page?.contentZh : page?.contentEn) || '').trim()

  // 行业筛选：从案例数据中提取可用行业，前台点击筛选（由 /case 路由透传 ?industry=）
  const industries = opts.industries || Array.from(new Set(cases.map((c) => c.industry).filter(Boolean)))
  const currentIndustry = String(opts.currentIndustry || '').trim()
  const filterBar = industries.length
    ? `<div class="case-filter-bar" style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px">
       <a class="case-filter-chip${!currentIndustry ? ' active' : ''}" href="/case">${escapeHtml(zh(locale, '全部行业', 'All industries'))}</a>
       ${industries.map((ind) => `<a class="case-filter-chip${currentIndustry === ind ? ' active' : ''}" href="/case?industry=${encodeURIComponent(ind)}">${escapeHtml(ind)}</a>`).join('')}
     </div>` : ''
  return `<section class="hero page-heading-hero">
  <div class="container">
    <span class="article-list-kicker">${escapeHtml(zh(locale, '成功案例', 'Case studies'))}</span>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
  </div>
</section>
<section class="section container">
  <div class="section-title">
    <div>
      <h2>${escapeHtml(label)}</h2>
      <p class="section-caption">${escapeHtml(zh(locale, `已交付 ${cases.length} 个案例`, `${cases.length} delivered cases`))}</p>
    </div>
  </div>
  ${filterBar}
  ${cases.length
    ? `<ul class="grid grid-3 case-card-grid">${cases.map((row) => caseCard(row, locale)).join('')}</ul>`
    : `<p style="color:var(--muted)">${escapeHtml(zh(locale, '暂未发布成功案例。', 'No case studies published yet.'))}</p>`}
</section>
${renderManagedSeoSection(pageContent, zh(locale, '案例说明', 'About our case studies'), locale)}`
}

function block(heading: string, body: string, className = ''): string {
  if (!body) return ''
  return `<section class="case-block ${className}">
    <h2>${escapeHtml(heading)}</h2>
    <div class="case-block-body">${body}</div>
  </section>`
}

function paragraphs(raw: string): string {
  const text = String(raw || '').trim()
  if (!text) return ''
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

export function renderCasePage(opts: {
  row: CaseRecord
  locale: Locale
  related?: CaseRecord[]
}): string {
  const { row, locale } = opts
  const related = opts.related || []
  const title = caseDisplayTitle(row)
  const summary = String(row.summary || '').trim()
  const results = parseCaseResults(row.results)
  const updated = String(row.updated_at || '').slice(0, 10)

  const resultsHtml = results.length
    ? `<ul class="case-results">${results.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : ''

  const applicable = [row.industry || '', row.region || ''].filter(Boolean).join(' / ')
  const scenarios = String(row.service_name || '').trim()
  const applicableHtml = applicable || scenarios
    ? `<section class="case-block case-block-applicable">
      <h2>${escapeHtml(zh(locale, '适用对象与常见场景', 'Applicable objects &amp; common scenarios'))}</h2>
      <div class="case-block-body">
        ${applicable ? `<p><strong>${escapeHtml(zh(locale, '适用对象', 'Applicable objects'))}：</strong>${escapeHtml(applicable)}</p>` : ''}
        ${scenarios ? `<p><strong>${escapeHtml(zh(locale, '常见场景', 'Common scenarios'))}：</strong>${escapeHtml(scenarios)}</p>` : ''}
      </div>
    </section>`
    : ''

  const breadcrumbTitle = title.length > 60 ? title.slice(0, 60) + '…' : title
  const crumbsHtml = `<nav class="breadcrumbs container" aria-label="${escapeHtml(t(locale, 'a11y.breadcrumb'))}">
    <ol>
      <li><a href="/">${escapeHtml(zh(locale, '首页', 'Home'))}</a></li>
      <li><a href="/case">${escapeHtml(zh(locale, '成功案例', 'Case studies'))}</a></li>
      <li aria-current="page">${escapeHtml(breadcrumbTitle)}</li>
    </ol>
  </nav>`

  return `<article class="section container case-detail">
  <section class="hero page-heading-hero">
    <div class="container page-heading-hero-inner">
      ${row.industry ? `<span class="article-list-kicker">${escapeHtml(row.industry)}</span>` : ''}
      <h1>${escapeHtml(title)}</h1>
      ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
      ${coverImage(row, locale, 1040, 520)}
      ${metaLine(row, locale) ? `<p class="article-meta">${escapeHtml(metaLine(row, locale).replace(/<p class="case-meta">|<\/p>/g, ''))}</p>` : ''}
    </div>
  </section>
  ${crumbsHtml}
  ${resultsHtml ? `<section class="case-block case-block-results">
    <h2>${escapeHtml(zh(locale, '项目成果', 'Results'))}</h2>
    <div class="case-block-body">${resultsHtml}</div>
  </section>` : ''}
  ${applicableHtml}
  ${block(zh(locale, '项目挑战', 'The challenge'), paragraphs(row.challenge))}
  ${block(zh(locale, '解决方案', 'How we solved it'), paragraphs(row.solution))}
  ${String(row.content || '').trim() ? `<section class="case-block">
    <h2>${escapeHtml(zh(locale, '项目详情', 'Project details'))}</h2>
    <div class="page-content-readable managed-content">${renderManagedRichText(String(row.content))}</div>
  </section>` : ''}
  ${String(row.testimonial || '').trim() ? `<blockquote class="case-testimonial">
    <p>${escapeHtml(String(row.testimonial).trim())}</p>
    <footer>${escapeHtml(row.client_name || title)}</footer>
  </blockquote>` : ''}
  ${String(row.project_url || '').trim() ? `<p class="case-project-link"><a href="${escapeHtml(String(row.project_url).trim())}" rel="nofollow noopener" target="_blank">${escapeHtml(zh(locale, '查看交付成果（外部链接）', 'View the delivered site (external)'))} →</a></p>` : ''}
  <div class="case-actions">
    <a class="btn" href="/contact">${escapeHtml(zh(locale, '咨询同类方案', 'Ask about a similar project'))} →</a>
    <a class="btn secondary" href="/case">${escapeHtml(zh(locale, '返回案例列表', 'All case studies'))} →</a>
  </div>
  ${updated ? `<p class="section-footnote">${escapeHtml(zh(locale, '最后更新：', 'Last updated: '))}${escapeHtml(updated)}</p>` : ''}
</article>
${related.length ? `<section class="section container">
  <div class="section-title">
    <div><h2>${escapeHtml(zh(locale, '更多成功案例', 'More case studies'))}</h2></div>
    <a href="/case">${escapeHtml(zh(locale, '全部案例', 'All cases'))} →</a>
  </div>
  <ul class="grid grid-3 case-card-grid">${related.map((item) => caseCard(item, locale)).join('')}</ul>
</section>` : ''}`
}

/** 首页「成功案例」模块。原来这里是「服务城市」，城市页仍在 /city 提供本地收录。 */
export function renderCaseHomeSection(opts: {
  cases: CaseRecord[]
  locale: Locale
  total: number
  label?: string
}): string {
  const { cases, locale, total } = opts
  const heading = opts.label || zh(locale, '成功案例', 'Case studies')
  if (!cases.length) return ''
  const more = total > cases.length
  return `<section class="section container home-cases-section">
  <div class="section-title">
    <div>
      <h2>${escapeHtml(heading)}</h2>
      <p class="section-caption">${escapeHtml(zh(locale, `已交付 ${total} 个项目的真实成果`, `${total} delivered projects and their results`))}</p>
    </div>
    <a href="/case">${escapeHtml(zh(locale, '查看全部', 'View all'))} →</a>
  </div>
  <ul class="grid grid-3 case-card-grid">${cases.map((row) => caseCard(row, locale)).join('')}</ul>
  ${more ? `<p class="section-footnote">${escapeHtml(zh(locale, `还有 ${total - cases.length} 个案例可在案例列表中查看。`, `${total - cases.length} more cases are available on the case list page.`))}</p>` : ''}
</section>`
}
