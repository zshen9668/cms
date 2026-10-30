/** 后台仪表盘：访问/内容/待办概览与内容新鲜度提醒。 */
import { escapeHtml } from './layout'
import { renderAdminLayout } from './adminLayout'
export function renderDashboard(stats: {
  articles: number; today: number; pending: number; keywords: number
  todayViews: number; trend: { date: string; views: number }[]
  topKeywords: { keyword: string; opportunity_score: number; city_name?: string; service_name?: string }[]
  /** 内容新鲜度与 GEO 完整性。统计口径见 routes/admin/dashboard.ts。 */
  contentHealth?: {
    publishedTotal: number
    staleDays: number
    staleTotal: number
    missingFaq: number
    missingCover: number
    missingDescription: number
    staleList: Array<{ id: number; title: string; slug: string; lastUpdated: string; ageDays: number }>
  }
}, siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const maxViews = Math.max(1, ...stats.trend.map((t) => t.views))
  const health = stats.contentHealth || {
    publishedTotal: 0, staleDays: 365, staleTotal: 0,
    missingFaq: 0, missingCover: 0, missingDescription: 0, staleList: [],
  }
  const healthColor = (value: number) => (value > 0 ? '#b45309' : '#1a8a4e')
  const healthCard = (value: number, label: string) => `
        <div><div style="font-size:22px;font-weight:700;color:${healthColor(value)}">${value}</div><div style="font-size:12px;color:var(--muted)">${label}</div></div>`
  return renderAdminLayout({
    title: '数据概览',
    active: '/admin', siteName, cspNonce, csrfToken,
    body: `
    <h2>数据概览</h2>
    <div class="stat-cards">
      <div class="stat-card"><div class="num">${stats.todayViews}</div><div class="label">今日访问量（抽样记录）</div></div>
      <div class="stat-card"><div class="num">${stats.articles}</div><div class="label">已发布文章</div></div>
      <div class="stat-card"><div class="num">${stats.pending}</div><div class="label">待审核内容</div></div>
      <div class="stat-card"><div class="num">${stats.keywords}</div><div class="label">关键词矩阵</div></div>
    </div>

    <div class="card dash-quick">
      <div class="dash-quick-head">
        <strong>快捷操作</strong>
        <span class="dash-quick-hint">最常用的入口，不用在左侧菜单里找</span>
      </div>
      <div class="dash-quick-grid">
        <a class="dash-quick-item" href="/admin/articles/new"><span aria-hidden="true">✍️</span><strong>写文章</strong><small>新建并发布内容</small></a>
        <a class="dash-quick-item" href="/admin/cases/new"><span aria-hidden="true">🏆</span><strong>加案例</strong><small>录入交付成果</small></a>
        <a class="dash-quick-item" href="/admin/news-sources"><span aria-hidden="true">📡</span><strong>新闻采集</strong><small>来源与定时任务</small></a>
        <a class="dash-quick-item" href="/admin/ai-prompts"><span aria-hidden="true">🧠</span><strong>AI 提示词</strong><small>统一识别并生成</small></a>
        <a class="dash-quick-item" href="/admin/ai-qa"><span aria-hidden="true">💬</span><strong>智能问答</strong><small>开关与回复设置</small></a>
        <a class="dash-quick-item" href="/admin/settings#industry-config"><span aria-hidden="true">🎯</span><strong>行业配置</strong><small>行业画像与业务配置</small></a>
        <a class="dash-quick-item" href="/admin/geo"><span aria-hidden="true">🧭</span><strong>GEO 自检</strong><small>AI 引用就绪度</small></a>
        <a class="dash-quick-item" href="/admin/media"><span aria-hidden="true">🖼️</span><strong>媒体库</strong><small>图片与文件</small></a>
        <a class="dash-quick-item" href="/admin/system"><span aria-hidden="true">🩺</span><strong>系统自检</strong><small>绑定与部署状态</small></a>
      </div>
    </div>

    ${(stats.pending > 0 || health.staleTotal > 0 || health.missingDescription > 0 || health.missingFaq > 0) ? `
    <div class="card dash-todo">
      <strong>待办提醒</strong>
      <ul>
        ${stats.pending > 0 ? `<li><a href="/admin/articles">${stats.pending} 篇文章待审核</a></li>` : ''}
        ${health.staleTotal > 0 ? `<li><a href="/admin/articles">${health.staleTotal} 篇文章超过 ${health.staleDays} 天未更新</a></li>` : ''}
        ${health.missingDescription > 0 ? `<li><a href="/admin/articles">${health.missingDescription} 篇文章缺少 SEO 描述</a></li>` : ''}
        ${health.missingFaq > 0 ? `<li><a href="/admin/articles">${health.missingFaq} 篇文章缺少问答（FAQ），拿不到 AI 问答引用位</a></li>` : ''}
      </ul>
    </div>` : ''}

    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">内容新鲜度与 GEO 完整性</h3>
      <p class="admin-help">AI 引擎与搜索引擎都偏好「近期更新过、信息完整」的页面。发布时间和更新时间会写进文章页的 <code>&lt;time&gt;</code> 与 Article 结构化数据；缺少 FAQ 的文章拿不到问答引用位。</p>
      ${health.publishedTotal === 0 ? '<p style="color:var(--muted);font-size:13px">还没有已发布文章。</p>' : `
      <div class="grid grid-4" style="margin:10px 0 14px">
        ${healthCard(health.publishedTotal, '已发布文章')}
        ${healthCard(health.staleTotal, `超过 ${health.staleDays} 天未更新`)}
        ${healthCard(health.missingFaq, '缺少文章问答（FAQ）')}
        ${healthCard(health.missingDescription, '缺少 SEO 描述')}
      </div>
      ${health.staleList.length ? `
      <table>
        <thead><tr><th>长期未更新</th><th>最后更新</th><th>已过天数</th><th></th></tr></thead>
        <tbody>
        ${health.staleList.map((row) => `<tr>
          <td>${escapeHtml(row.title)}</td>
          <td style="font-size:12px;color:var(--muted)">${escapeHtml(row.lastUpdated || '—')}</td>
          <td><span class="badge">${row.ageDays}</span></td>
          <td><a href="/admin/articles/${row.id}/edit">编辑</a></td>
        </tr>`).join('')}
        </tbody>
      </table>` : `<p style="color:var(--muted);font-size:13px">没有超过 ${health.staleDays} 天未更新的文章。</p>`}
      ${health.missingCover > 0 ? `<p style="font-size:12px;color:var(--muted);margin-top:10px">另有 ${health.missingCover} 篇文章没有封面图：文章页会退化成用站点图标做分享图，建议补一张。</p>` : ''}
      `}
    </div>

    <div class="card" style="margin-bottom:20px">
      <h3>近 ${stats.trend.length} 天访问趋势</h3>
      ${stats.trend.length ? `
      <div style="display:flex;align-items:flex-end;gap:10px;height:120px;padding-top:10px">
        ${stats.trend.map((t) => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px">
            <div style="width:100%;max-width:36px;background:var(--primary);border-radius:4px 4px 0 0;height:${Math.max(4, Math.round((t.views / maxViews) * 90))}px" title="${t.date}: ${t.views}"></div>
            <div style="font-size:11px;color:var(--muted)">${t.date.slice(5)}</div>
          </div>`).join('')}
      </div>` : `<p style="color:var(--muted);font-size:13px">暂无访问数据，网站有访客后这里会显示趋势</p>`}
    </div>

    <div class="card" style="margin-bottom:20px">
      <h3>热门关键词（按机会分排序）<a class="btn secondary btn-sm" href="/admin/keywords" style="margin-left:10px;font-size:12px;padding:4px 10px">[去生成 →]</a></h3>
      ${stats.topKeywords.length ? `
      <table>
        <thead><tr><th>关键词</th><th>城市</th><th>服务</th><th>机会分</th></tr></thead>
        <tbody>
        ${stats.topKeywords.map((k) => `<tr>
          <td>${k.keyword}</td><td>${k.city_name || ''}</td><td>${k.service_name || ''}</td><td>${k.opportunity_score}</td>
        </tr>`).join('')}
        </tbody>
      </table>` : `<p style="color:var(--muted);font-size:13px">还没有关键词数据，去「关键词管理」一键生成矩阵</p>`}
    </div>
  `,
  })
}
