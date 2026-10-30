/** 后台 SEO/GEO 域模板：关键词矩阵、SEO 总览、GEO 中控与结构化数据校验器。 */
import { escapeHtml } from './layout'
import type { SeoAuditPage, SeoAuditResult } from '../utils/seoAudit'
import type { GeoCheckResult } from '../utils/geoCheck'
import { renderAdminLayout } from './adminLayout'

function renderSeoAuditPanel(seoAudit: { pages: Array<SeoAuditPage & { audit: SeoAuditResult; dbId?: number }>; summary: { total: number; average: number; good: number; optimize: number; weak: number; blocked: number; indexable: number; lowQuality: number } }): string {
  const lowPages = seoAudit.pages
    .filter((p) => p.audit.status === 'weak' || p.audit.status === 'blocked')
    .sort((a, b) => a.audit.score - b.audit.score)
    .slice(0, 20)
  const typeLabel: Record<string, string> = { home: '首页', list: '列表页', article: '文章', city: '城市', service: '服务', landing: '城市x服务' }
  const rows = lowPages.map((p) => {
    const isManaged = p.type === 'home' || p.type === 'list'
    const managedKey = isManaged ? String(p.key || '') : ''
    const canDelete = !!(p.aiGenerated && (isManaged || ['article', 'city', 'service', 'landing'].includes(p.type)) && (isManaged || p.dbId))
    const deleteForm = canDelete
      ? '<form method="post" action="/admin/seo-audit/delete" style="display:inline" onsubmit="return confirm(\'确认删除这个低质量 AI 内容？页面本体不会删除；城市x服务落地页会同步删除关键词入口。\')"><input type="hidden" name="type" value="' + escapeHtml(p.type) + '"><input type="hidden" name="key" value="' + escapeHtml(managedKey) + '"><input type="hidden" name="id" value="' + escapeHtml(String(p.dbId || '')) + '"><button class="btn secondary" style="padding:4px 9px">清理 AI 内容</button></form>'
      : ''
    const optimizePath = isManaged
      ? '/admin/pages/' + managedKey + '/edit'
      : p.type === 'article'
        ? '/admin/articles/' + p.dbId + '/edit'
        : p.type === 'city'
          ? '/admin/cities/' + p.dbId + '/edit'
          : p.type === 'service'
            ? '/admin/services/' + p.dbId + '/edit'
            : p.type === 'landing'
              ? '/admin/keywords/' + p.dbId + '/edit'
              : ''
    const optimize = optimizePath ? '<a href="' + escapeHtml(optimizePath) + '" style="margin-left:8px">查看/编辑</a>' : ''
    const optimizeAction = p.aiGenerated && (p.audit.status === 'weak' || p.audit.status === 'blocked')
      ? '<form method="post" action="/admin/seo-audit/optimize-one" style="display:inline;margin-left:8px" onsubmit="return confirm(\'建议先让 AI 重新优化此页面。继续？\')"><input type="hidden" name="type" value="' + escapeHtml(p.type) + '"><input type="hidden" name="id" value="' + escapeHtml(String(p.dbId || '')) + '"><input type="hidden" name="key" value="' + escapeHtml(managedKey) + '"><button class="btn secondary" style="padding:4px 9px">AI优化</button></form>'
      : ''
    const actionHint = p.audit.status === 'weak' ? '<span style="color:#ad6800;font-size:11px">建议AI优化后复评</span>' : p.audit.status === 'blocked' ? '<span style="color:#e5484d;font-size:11px">当前没有公开SEO入口</span>' : ''
    return '<tr><td>' + escapeHtml(typeLabel[p.type] || p.type) + '</td><td><a href="' + escapeHtml(p.url) + '" target="_blank" rel="noopener">' + escapeHtml(p.title || p.url) + '</a></td><td><strong>' + p.audit.score + '</strong></td><td>' + escapeHtml(p.audit.label) + '</td><td>' + escapeHtml(p.audit.reasons.slice(0, 3).join('；') || '需要检查内容') + '<br>' + actionHint + '</td><td>' + optimize + optimizeAction + deleteForm + '</td></tr>'
  }).join('')

  return [
    '<div class="card seo-audit-dashboard" style="margin-bottom:16px">',
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div><h3 style="margin:0">SEO 收录机会整体评估</h3><p style="margin:6px 0 0;color:var(--muted);font-size:12px;line-height:1.7">这是站内技术与内容质量评估，不代表搜索引擎已经收录，也不能保证一定收录。弱质页面优先重新生成；真正低质量或当前不可索引的 AI 内容才进入删除队列，人工内容不会被批量删除。</p></div><div class="admin-actions"><button class="btn secondary" type="button" id="seoAuditOptimizeBtn">🤖 一键优化 50–67 分 AI页面</button><button class="btn secondary" type="button" id="seoAuditDeleteBtn">🧹 一键删除 &lt;50 / 不可索引 AI内容</button></div></div>',
    '<div id="seoAuditBatchStatus" style="margin-top:10px;color:var(--muted);font-size:12px;line-height:1.7"></div>',
    '<script>(function(){var opt=document.getElementById("seoAuditOptimizeBtn"),del=document.getElementById("seoAuditDeleteBtn"),status=document.getElementById("seoAuditBatchStatus");if(!opt||!del||!status)return;async function purge(){try{var f=new URLSearchParams();f.set("scope","cache");f.set("phase","d1");f.set("cursor","");await fetch("/admin/production-cleanup",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},credentials:"same-origin",body:f.toString()});}catch(e){}}async function run(endpoint,label,confirmText){if(!confirm(confirmText))return;opt.disabled=true;del.disabled=true;var total=0,excluded=[];status.textContent=label+"：处理中，请勿关闭页面…";try{while(true){var f=new URLSearchParams();f.set("ajax","1");if(excluded.length)f.set("exclude",excluded.join(","));var res=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},credentials:"same-origin",body:f.toString()});var data=await res.json().catch(function(){return {ok:false,error:"服务器返回无效JSON"};});if(!res.ok||!data.ok)throw new Error(data.error||"操作失败");total+=Number(data.processed||0);if(data.key&&!excluded.includes(data.key))excluded.push(data.key);status.textContent=label+"：已处理 "+total+" 项"+(data.remainingHint?"，继续处理…":"");if(data.complete)break;}await purge();status.textContent=label+"：完成，共处理 "+total+" 项，公开缓存已刷新。";setTimeout(function(){location.reload()},800);}catch(e){status.textContent=label+"：中断："+(e&&e.message?e.message:e);opt.disabled=false;del.disabled=false;}}opt.addEventListener("click",function(){run("/admin/seo-audit/optimize-low-batch","一键优化","服务器会逐项重新生成 50–67 分的 AI 页面，只处理 AI 生成内容；确认继续？")});del.addEventListener("click",function(){run("/admin/seo-audit/cleanup-low-batch","一键删除","将逐项删除评分 &lt;50 或当前不可索引的 AI 内容；城市/服务本体不删除，落地页会删除对应关键词入口。删除不可恢复，确认继续？")});})();</script>',
    '<div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px;margin-top:14px">',
    '<div class="stat-card"><div class="label">评估页面</div><div class="num">' + seoAudit.summary.total + '</div></div>',
    '<div class="stat-card"><div class="label">平均机会分</div><div class="num">' + seoAudit.summary.average + '</div></div>',
    '<div class="stat-card"><div class="label">条件较完整</div><div class="num">' + seoAudit.summary.good + '</div></div>',
    '<div class="stat-card"><div class="label">建议优化</div><div class="num">' + (seoAudit.summary.optimize + seoAudit.summary.weak) + '</div></div>',
    '<div class="stat-card"><div class="label">低质量</div><div class="num">' + seoAudit.summary.lowQuality + '</div></div>',
    '<div class="stat-card"><div class="label">具备可索引条件</div><div class="num">' + seoAudit.summary.indexable + '</div></div>',
    '<div class="stat-card"><div class="label">不可索引</div><div class="num">' + seoAudit.summary.blocked + '</div></div>',
    '</div>',
    '<div style="margin-top:14px;padding:10px 12px;background:#f8fbff;border:1px solid #dbe7f7;border-radius:8px;font-size:12px;line-height:1.8"><strong>分数说明：</strong>82+ = 收录基础条件较完整；68–81 = 具备基础条件但建议优化；50–67 = 页面价值偏弱，可一键重新生成；低于50 = 低质量；不可索引 = 当前没有公开 SEO 入口。批量删除只处理 AI 生成内容。</div>',
    lowPages.length
      ? '<details open style="margin-top:14px"><summary style="cursor:pointer;font-weight:650">低质量 / 不可索引页面（前20）</summary><div class="admin-table-wrap" style="margin-top:10px"><table><thead><tr><th>类型</th><th>页面</th><th>评分</th><th>判断</th><th>主要问题</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>'
      : '<p style="margin:14px 0 0;color:#389e0d;font-size:12px">当前没有需要批量优化或删除的 AI 页面。</p>',
    '</div>',
  ].join('')
}

export function renderKeywordsList(rows: any[], siteKeywords = '', message = '', cleanupPending = 0, seoStats: { keywordCleanup: number; duplicateKeywords: number; duplicateKeywordGroups: number; generatedCities: number; generatedServices: number; generatedLandings: number; sitemapLandings: number; publishedAiArticles: number; generatedAiArticles: number; lowScorePublishedAiArticles: number; invalidCities: number; invalidServices: number; invalidLandings: number; invalidTotal: number } = { keywordCleanup: 0, duplicateKeywords: 0, duplicateKeywordGroups: 0, generatedCities: 0, generatedServices: 0, generatedLandings: 0, sitemapLandings: 0, publishedAiArticles: 0, generatedAiArticles: 0, lowScorePublishedAiArticles: 0, invalidCities: 0, invalidServices: 0, invalidLandings: 0, invalidTotal: 0 }, seoAudit: { pages: Array<(SeoAuditPage & { audit: SeoAuditResult; dbId?: number })>; summary: { total: number; average: number; good: number; optimize: number; weak: number; blocked: number; indexable: number; lowQuality: number } } = { pages: [], summary: { total: 0, average: 0, good: 0, optimize: 0, weak: 0, blocked: 0, indexable: 0, lowQuality: 0 } }, siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const validCount = rows.filter((k: any) => k.opportunity_score > 0 && k.city_name && k.service_name).length
  const invalidCount = rows.length - validCount
  const validRate = rows.length ? Math.round((validCount / rows.length) * 100) : 0

  return renderAdminLayout({
    title: '统一 SEO 关键词', active: '/admin/keywords', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <h2>统一 SEO 关键词</h2>
      <div class="admin-actions keyword-actions">
        <div class="btn-group primary">
          <form method="post" action="/admin/keywords/ai-generate" style="display:inline" onsubmit="return confirm('只生成/追加全站候选词，不直接改写城市、服务、文章的页面 SEO。继续？')"><button class="btn" type="submit" title="根据站点行业画像，AI 生成新的关键词候选并追加到矩阵中，不改写已有页面 SEO。"><span>🤖 AI生成候选词</span></button></form>
          <form method="post" action="/admin/keywords/generate" style="display:inline" onsubmit="return confirm('只生成/更新城市×服务关键词矩阵并计算机会分，不自动改写页面 SEO。人工搜索量不会被覆盖。继续？')"><button class="btn" type="submit" title="根据所有城市 × 服务组合生成关键词矩阵，并按统一规则重新计算每条记录的机会分。"><span>一键生成/更新矩阵</span></button></form>
        </div>
        <div class="btn-group secondary">
          <form method="post" action="/admin/keywords/rescore" style="display:inline" onsubmit="return confirm('只重新计算关键词矩阵机会分，不修改页面 SEO 标题、描述或 seo_keywords。继续？')"><button class="btn secondary" type="submit" title="按城市等级、服务权重、难度、搜索量等维度，重新计算每条关键词的机会分，不改写页面元数据。"><span>重新计算机会分</span></button></form>
          <button class="btn secondary" type="button" onclick="document.getElementById('seo-cleanup-options')?.scrollIntoView({behavior:'smooth'})" title="清理 D1 中明确失效/重复的 SEO 数据，不删除人工文章、城市、服务或正常 SEO 页面。"><span>🧹 清理生产库</span></button>
          <form method="post" action="/admin/seo/auto-fill" style="display:inline" onsubmit="return confirm('只对城市、服务、已发布文章的 SEO 标题、描述和 3-5 个主题词进行规范，不修改固定候选词库、关键词矩阵或 AI 提示词。继续？')"><button class="btn secondary" type="submit" title="按主题词模板补齐城市、服务、已发布文章的 SEO 标题、描述和页面主题词。"><span>一键规范全部页面SEO</span></button></form>
        </div>
      </div>
    </div>

    <div class="seo-stats-bar">
      <span class="stat-item"><strong>共 ${rows.length} 条</strong> 关键词</span>
      <span class="stat-item"><strong>有效 ${validCount}</strong>（城市+服务+机会分均有效）</span>
      <span class="stat-item"><strong>重复/失效 ${invalidCount}</strong> 条</span>
      <span class="stat-item"><strong>有效率 ${validRate}%</strong></span>
    </div>

    <div class="seo-filter-bar">
      <form method="get" action="/admin/keywords" class="admin-form filter-form" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <label>城市</label>
        <select name="city" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;font-size:13px">
          <option value="">全部城市</option>
          ${Array.from(new Set(rows.filter((r:any) => r.city_name).map((r:any) => r.city_name))).sort().map((city: string) => `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`).join('')}
        </select>
        <label>服务</label>
        <select name="service" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;font-size:13px">
          <option value="">全部服务</option>
          ${Array.from(new Set(rows.filter((r:any) => r.service_name).map((r:any) => r.service_name))).sort().map((service: string) => `<option value="${escapeHtml(service)}">${escapeHtml(service)}</option>`).join('')}
        </select>
        <label>最低机会分</label>
        <input name="min_score" type="number" min="0" max="100" step="5" value="" placeholder="0" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;font-size:13px;width:70px" />
        <button class="btn" type="submit" style="padding:6px 16px">筛选</button>
        <a class="btn secondary" href="/admin/keywords" style="padding:6px 16px">重置</a>
      </form>
    </div>

    ${message ? `<div class="card" style="border-left:4px solid ${message.startsWith('AI关键词已生成') || message.startsWith('生产库清理完成') ? '#1a8a4e' : '#e5484d'};margin-bottom:16px">${escapeHtml(message)}</div>` : ''}

    <div class="seo-cleanup-panel" id="seo-cleanup-options">
      <div class="cleanup-header" onclick="toggleCleanupPanel()">
        <strong>🧹 生产库清理</strong>
        <span class="badge">${cleanupPending > 0 ? '发现 ' + cleanupPending + ' 项 D1 失效/重复数据' : '当前没有 D1 失效/重复 SEO 数据'}</span>
        <span class="cleanup-toggle">▼</span>
      </div>
      <div class="cleanup-body" id="seo-cleanup-body" style="display:none">
        <p><strong>无效关键词：</strong>${seoStats.keywordCleanup} 条；<strong>重复关键词：</strong>${seoStats.duplicateKeywords} 条（${seoStats.duplicateKeywordGroups} 组）；<strong>失效 AI 页面：</strong>${seoStats.invalidTotal} 条。</p>
        <p><strong>当前 Sitemap 有效机会分 SEO 落地页：</strong>${seoStats.sitemapLandings} 个；<strong>已发布 AI 文章：</strong>${seoStats.publishedAiArticles} 篇；其中 AI评分低于 65：${seoStats.lowScorePublishedAiArticles} 篇。</p>
        <form method="post" action="/admin/keywords/cleanup" style="margin:10px 0" onsubmit="return confirm('确认勾选的删除范围。全量 AI/SEO 生成数据删除后不可恢复，并会同步清理审核日志、社交分发记录和公开缓存。')">
          <label style="display:flex;gap:8px;align-items:flex-start;margin:10px 0;padding:10px;border:1px solid #ffd591;border-radius:8px;background:#fffaf0">
            <input type="checkbox" name="cleanup_all_generated" value="on" />
            <span><strong>🧹 全量清理 AI/SEO 生成生产数据</strong><br><small>删除全部关键词矩阵、全部 AI 生成文章、全部 AI 城市/服务/落地页内容及旧版 AI 内容；同步清理文章对应审核日志、社交分发记录，并在返回前执行 Worker 全量缓存清理。不会删除管理员、城市、服务、人工文章或站点基础配置。</small></span>
          </label>
          <label style="display:flex;gap:8px;align-items:flex-start;margin:10px 0">
            <input type="checkbox" name="cleanup_invalid" value="on" checked />
            <span><strong>清理无效 SEO 数据</strong><br><small>删除机会分 ≤ 0 / 无关联关键词，以及失效 AI SEO 页面。</small></span>
          </label>
          <label style="display:flex;gap:8px;align-items:flex-start;margin:10px 0">
            <input type="checkbox" name="cleanup_duplicate_keywords" value="on" />
            <span><strong>清理重复 SEO 关键词（${seoStats.duplicateKeywords} 条）</strong><br><small>按“城市 + 服务 + 关键词”去重，保留机会分/搜索量更高的记录；重复记录对应的 AI 落地页内容也同步清理。</small></span>
          </label>
          <label style="display:flex;gap:8px;align-items:flex-start;margin:10px 0">
            <input type="checkbox" name="delete_sitemap_landings" value="on" />
            <span><strong>删除当前 Sitemap 有效机会分 SEO 落地页（${seoStats.sitemapLandings} 个）</strong><br><small>删除对应关键词和 AI 落地页内容，使这些 URL 不再进入 Sitemap。</small></span>
          </label>
          <label style="display:flex;gap:8px;align-items:flex-start;margin:10px 0">
            <input type="checkbox" name="delete_ai_articles" value="on" />
            <span><strong>删除全部已发布 AI 文章（${seoStats.publishedAiArticles} 篇）</strong><br><small>删除文章、审核日志、社交分发关联记录。</small></span>
          </label>
          <label style="display:flex;gap:8px;align-items:flex-start;margin:10px 0">
            <input type="checkbox" name="delete_low_ai_articles" value="on" />
            <span><strong>删除 AI评分低于阈值的已发布 AI 文章（当前 ${seoStats.lowScorePublishedAiArticles} 篇）</strong><br><small>阈值 <input name="ai_score_threshold" type="number" min="0" max="100" value="65" style="width:70px" />；同步删除审核日志、社交分发关联记录。</small></span>
          </label>
          <button class="btn" type="submit">执行所选删除</button>
        </form>
        <p class="admin-field-hint">“全量清理 AI/SEO 生成生产数据”会一次删除全部关键词矩阵、AI文章和 AI 城市/服务/落地页内容，并同步清理关联审核/社交记录与 Worker 全量缓存；不会删除管理员、城市、服务、人工文章或站点基础配置。普通刷新或 CF 部署不会自动触发删除。</p>
      </div>
    </div>

    <p style="color:var(--muted);font-size:13px">这 5 个操作职责不同：机会分只算分；清理生产库删除明确无效/重复的生产数据；AI候选词只维护全站候选词库；生成/更新矩阵只维护城市×服务关键词矩阵；规范全部页面SEO只会修改页面标题、描述和页面 seo_keywords。固定候选词库不会被最后一项覆盖。</p>

    <div class="admin-table-wrap">
      <table>
        <thead><tr><th>关键词</th><th>城市</th><th>服务</th><th>机会分</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
        ${rows.map((k) => `<tr>
          <td>${escapeHtml(k.keyword)}</td><td>${escapeHtml(k.city_name || '-')}</td><td>${escapeHtml(k.service_name || '-')}</td>
          <td>${k.opportunity_score}</td><td>${escapeHtml(k.status)}</td>
          <td><a href="/admin/keywords/${k.id}/edit">编辑</a> &nbsp; <form style="display:inline" method="post" action="/admin/keywords/${k.id}/delete" onsubmit="return confirm('确认删除该关键词及其AI落地页内容？删除后不可恢复。')"><button class="btn secondary" style="padding:2px 10px;color:#e5484d" type="submit">删除</button></form></td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>
    `,
  })
}

export function renderKeywordForm(kw: any, aiContent?: any, siteName?: string, cspNonce?: string, csrfToken?: string): string {
  return renderAdminLayout({
    title: '编辑关键词', active: '/admin/keywords', siteName, cspNonce, csrfToken,
    body: `
    <h2>编辑关键词：${escapeHtml(kw.keyword)}</h2>
    <form class="admin-form" method="post" action="/admin/keywords/${kw.id}/edit">
      <label>真实搜索量（人工从第三方关键词工具核实后回填，用于重新计分）</label>
      <input type="number" name="search_volume" min="0" value="${kw.search_volume || 0}" />
      <label>难度</label>
      <select name="difficulty">
        ${['低', '中', '高'].map((d) => `<option value="${d}" ${kw.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
      <label>状态</label>
      <select name="status">
        ${['pending', 'published', 'ranking'].map((s) => `<option value="${s}" ${kw.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <label>内容权重（自动取当前机会分，机会分越高，AI落地页内容应越完整）</label>
      <input value="${kw.opportunity_score || 0}" disabled />
      <p style="color:var(--muted);font-size:12px">对应落地页：${escapeHtml(kw.landing_slug || '-')}；AI内容：${aiContent?.content ? '已生成' : '尚未生成'}</p>
      <label>备注</label>
      <textarea name="note" rows="2">${escapeHtml(kw.note || '')}</textarea>

      <button class="btn" type="submit">保存并重新计分</button>
    </form>
    <form method="post" action="/admin/keywords/${kw.id}/ai-content" style="margin-top:10px"><button class="btn secondary" type="submit">🤖 AI 生成对应落地页内容</button></form>
    <form method="post" action="/admin/keywords/${kw.id}/content/delete" onsubmit="return confirm('确认删除该关键词落地页AI内容？删除后不可恢复。')" style="margin-top:10px"><button class="btn secondary" type="submit">删除落地页内容</button></form>
  `,
  })
}

export function renderGeoPage(opts: {
  siteUrl: string
  aiCrawlersEnabled: boolean
  llmsEnabled: boolean
  saved?: boolean
  error?: string
  seoSummary?: { total: number; average: number; good: number; optimize: number; weak: number; blocked: number; indexable: number; lowQuality: number }
  geoArticles?: Array<{ id: number; title: string; slug: string; aiGenerated: boolean; check: GeoCheckResult }>
  citationSummary?: Array<{ platform: string; checks: number; mentions: number; rate: number }>
  citationTotal?: number
  probeLimit?: number
  crawlerStats?: {
    totals: Array<{ bot: string; hits: number; lastSeen: string }>
    today: Array<{ bot: string; hits: number; lastPath: string; lastSeen: string }>
    windowDays: number
  }
  entity?: {
    authorName: string
    authorTitle: string
    authorCredentials: string
    authorExpertise: string
    authorUrl: string
    logoUrl: string
    ogImage: string
    socialLinks: string
  }
  siteName?: string, cspNonce?: string, activeTab?: string, csrfToken?: string
}): string {
  const crawlers = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'Bytespider', 'CCBot', 'Meta-ExternalAgent']
  const seo = opts.seoSummary
  const articles = opts.geoArticles || []
  const citations = opts.citationSummary || []
  const entity = opts.entity || {
    authorName: '', authorTitle: '', authorCredentials: '', authorExpertise: '',
    authorUrl: '', logoUrl: '', ogImage: '', socialLinks: '',
  }
  const geoPassing = articles.filter((a) => a.check.passed === a.check.total).length
  const geoWeak = articles.length - geoPassing
  const citationBlock = `
    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">AI 引用监测(各平台提及率)</h3>
      <p class="admin-help">记录 AI 平台回答中是否提及或引用本站。可手动录入其它平台的回答结果，也可用当前已配置的 AI 通道抽样检测(每日上限 ${opts.probeLimit || 10} 次，节省免费额度)。提及率只反映抽样结果，不代表真实流量或排名。</p>
      ${citations.length ? `<table><thead><tr><th>平台</th><th>检测次数</th><th>提及次数</th><th>提及率</th></tr></thead><tbody>
        ${citations.map((r) => `<tr><td>${escapeHtml(r.platform)}</td><td>${r.checks}</td><td>${r.mentions}</td><td><span class="badge">${r.rate}%</span></td></tr>`).join('')}
      </tbody></table><p style="font-size:12px;color:var(--muted)">共 ${opts.citationTotal || 0} 条记录(最近 500 条参与统计)</p>` : '<p style="color:var(--muted)">暂无引用记录。</p>'}
      <div class="grid grid-2" style="margin-top:12px">
        <form method="post" action="/admin/geo/citations" class="admin-form">
          <h4 style="margin:0 0 8px">手动录入一条结果</h4>
          <label>平台</label><input name="platform" maxlength="60" placeholder="例如 DeepSeek / Kimi / 文心一言" required />
          <label>模型(可选)</label><input name="model" maxlength="120" placeholder="例如 deepseek-chat" />
          <label>查询问题</label><input name="query" maxlength="300" required />
          <label>引用链接(可选)</label><input name="cited_url" maxlength="500" placeholder="https://..." />
          <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="mentioned" /> 回答中提及或引用了本站</label>
          <button class="btn secondary" type="submit">录入</button>
        </form>
        <form method="post" action="/admin/geo/citations/probe" class="admin-form">
          <h4 style="margin:0 0 8px">用内部 AI 通道抽样检测</h4>
          <label>检测问题</label><input name="query" maxlength="300" required placeholder="例如:某某行业怎么办理资料核验?" />
          <p style="font-size:12px;color:var(--muted)">使用「AI 设置」中的主通道提问,自动判断回答是否包含本站域名或站点名。</p>
          <button class="btn" type="submit">抽样检测</button>
        </form>
      </div>
    </div>`
  const crawlerStats = opts.crawlerStats || { totals: [], today: [], windowDays: 30 }
  const crawlerTodayMap = new Map<string, { bot: string; hits: number; lastPath: string; lastSeen: string }>()
  for (const row of crawlerStats.today) crawlerTodayMap.set(row.bot, row)
  const crawlerBlock = `
    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">🤖 AI 爬虫访问统计</h3>
      <p class="admin-help">回答一个最关键的问题：GPTBot / ClaudeBot / PerplexityBot 到底有没有来抓过。只统计命中 AI 爬虫 User-Agent 的公开页面请求，普通访客不写库。这里是「被请求次数」，不是「被引用次数」——是否真的被引用仍要看下面的引用监测。</p>
      ${crawlerStats.totals.length
        ? `<table><thead><tr><th>爬虫</th><th>今日</th><th>近 ${crawlerStats.windowDays} 天</th><th>最近访问</th><th>今日最后一次请求</th></tr></thead><tbody>
        ${crawlerStats.totals.map((row) => {
          const today = crawlerTodayMap.get(row.bot)
          return `<tr>
            <td><code>${escapeHtml(row.bot)}</code></td>
            <td>${today ? today.hits : 0}</td>
            <td><strong>${row.hits}</strong></td>
            <td style="font-size:12px;color:var(--muted)">${escapeHtml(row.lastSeen || '—')}</td>
            <td style="font-size:12px;color:var(--muted)">${today && today.lastPath ? escapeHtml(today.lastPath) : '—'}</td>
          </tr>`
        }).join('')}
      </tbody></table>`
        : `<p style="color:var(--muted)">近 ${crawlerStats.windowDays} 天还没有记录到 AI 爬虫访问。刚上线时这是正常的——机器人发现新站点通常需要几天到几周。</p>`}
      <p style="font-size:12px;color:var(--muted);line-height:1.8;margin-top:10px">一直没有访问时依次检查：① <a href="/robots.txt" target="_blank">robots.txt</a> 是否放行对应爬虫（确认上方「AI 爬虫白名单」处于开启状态）；② 站点是否已被搜索引擎收录——爬虫通常先通过搜索结果或外链发现站点；③ Sitemap 是否可访问。能主动做的只有这几点，AI 平台最终是否抓取由对方决定。</p>
    </div>`
  const activeTab = opts.activeTab || 'geo'
  const tabBar =
    '<a class="btn ' + (activeTab === 'geo' ? '' : 'secondary') + '" href="/admin/geo?tab=geo">GEO 体检</a>' +
    '<a class="btn ' + (activeTab === 'crawler' ? '' : 'secondary') + '" href="/admin/geo?tab=crawler">AI 爬虫统计</a>'
  const geoHelp =
    '<p class="admin-help">GEO 不是保证被 AI 引用，而是让 AI/Agent 更容易理解网站主题、找到公开页面并正确引用。这里统一查看 <code>/llms.txt</code>、AI 爬虫白名单和结构化数据；最终是否抓取、索引或引用仍由对应平台决定。</p>'
  const savedMsg = opts.saved ? '<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">GEO 设置已保存。</div>' : ''
  const errorMsg = opts.error ? '<div class="card" style="border-left:4px solid #e5484d;color:#c92a2a;margin-bottom:16px">' + escapeHtml(opts.error) + '</div>' : ''
  const checks: Array<{ label: string; ok: boolean; hint: string; anchor: string }> = [
    { label: 'AI 爬虫白名单', ok: opts.aiCrawlersEnabled, hint: 'robots.txt 显式允许 GPTBot / ClaudeBot 等抓取', anchor: '#geoControl' },
    { label: 'llms.txt', ok: opts.llmsEnabled, hint: '给 AI 引擎的站点摘要入口', anchor: '#geoControl' },
    { label: '署名作者', ok: !!entity.authorName, hint: '文章页输出 Person 实体（E-E-A-T）', anchor: '#geoEntity' },
    { label: '资质说明', ok: !!entity.authorCredentials, hint: '写入 Person.description，提升可信度', anchor: '#geoEntity' },
    { label: '站点 logo', ok: !!entity.logoUrl, hint: 'Organization.logo，Google 富结果必需', anchor: '#geoEntity' },
    { label: '默认分享图', ok: !!entity.ogImage, hint: 'og:image，建议 1200×630', anchor: '#geoEntity' },
    { label: '官方主页', ok: !!entity.socialLinks, hint: '写入 Organization.sameAs，帮助 AI 确认主体', anchor: '#geoEntity' },
  ]
  const done = checks.filter((c) => c.ok).length
  const readinessListHtml = checks.map((c) =>
    '<li class="' + (c.ok ? 'is-ok' : 'is-todo') + '"><a href="' + c.anchor + '"><span aria-hidden="true">' + (c.ok ? '✅' : '⬜') + '</span> ' +
    escapeHtml(c.label) + '</a><small>' + escapeHtml(c.hint) + '</small></li>'
  ).join('')
  const readinessNote =
    done < checks.length
      ? '<p class="geo-readiness-note">未配置的项不会让站点报错，但会削弱 AI 引擎对「这是谁、值不值得引用」的判断。点上面任一项可直接跳到对应表单。</p>'
      : '<p class="geo-readiness-note">全部就绪。GEO 不保证被引用，但已把可被 AI 正确理解与引用的条件准备完整。</p>'
  const readinessHtml =
    '<div class="card geo-readiness">' +
    '<div class="geo-readiness-head">' +
    '<strong>GEO 就绪度</strong>' +
    '<span class="badge">' + done + '/' + checks.length + ' 项已配置</span>' +
    '<span class="geo-readiness-bar"><span style="width:' + Math.round((done / checks.length) * 100) + '%"></span></span>' +
    '</div>' +
    '<ul class="geo-readiness-list">' + readinessListHtml + '</ul>' +
    readinessNote +
    '</div>'
  const crawlerHtml = activeTab === 'crawler' ? crawlerBlock : (
    geoHelp + savedMsg + errorMsg + readinessHtml +
    '<div class="card" style="margin-top:16px">' +
    '<strong>Google / Sitemap 说明</strong>' +
    '<p style="color:var(--muted);font-size:12px;line-height:1.8;margin-bottom:0">Google 已停止 Sitemap Ping；本系统不再自动调用任何 Sitemap Ping；网站仍然提供 ' + opts.siteUrl + '/sitemap.xml，并建议在 Google Search Console 中提交。Google Indexing API 不能作为普通行业页面的通用提交接口。</p>' +
    '</div>'
  )
  const ctrl =
    '<form class="admin-form card" method="post" action="/admin/geo" id="geoControl" style="margin-top:16px">' +
    '<h3 style="margin-top:0">GEO 控制</h3>' +
    '<label style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="geo_ai_crawlers_enabled" ' + (opts.aiCrawlersEnabled ? 'checked' : '') + ' /> 显式允许主要 AI/答案引擎爬虫</label>' +
    '<label style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="geo_llms_enabled" ' + (opts.llmsEnabled ? 'checked' : '') + ' /> 发布 /llms.txt</label>' +
    '<p style="font-size:12px;color:var(--muted);line-height:1.8">这两个开关只控制 GEO 辅助入口，不会隐藏正常公开页面，也不会改变 Sitemap。关闭 AI 爬虫白名单时，robots.txt 仍允许普通搜索引擎抓取公开内容。</p>' +
    '<button class="btn" type="submit">保存 GEO 设置</button>' +
    '</form>'
  const entityForm =
    '<form class="admin-form card" method="post" action="/admin/geo/entity" id="geoEntity" style="margin-top:16px">' +
    '<h3 style="margin-top:0">署名与站点实体（E-E-A-T）</h3>' +
    '<p class="admin-help">AI 引擎判断「这条内容值不值得引用」时，会看作者是谁、有没有资质、站点是不是真实主体。填写后全站每个页面都会输出 <code>Person</code> 作者实体，以及 <code>Organization.logo</code> 与 <code>sameAs</code>；留空则回退到组织署名，Google 的 Organization 富结果也会因为缺少 logo 而校验不通过。</p>' +
    (entity.authorName
      ? '<p style="font-size:12px"><span class="badge">已配置署名：' + escapeHtml(entity.authorName) + '</span></p>'
      : '<p style="font-size:12px;color:#b45309">尚未配置署名：文章页只会输出组织署名，没有 Person 实体。</p>') +
    '<div class="grid grid-2">' +
    '<div>' +
    '<label>署名作者 / 编辑部</label>' +
    '<input name="site_author_name" maxlength="80" value="' + escapeHtml(entity.authorName) + '" placeholder="例如：张明 或 本站编辑部" />' +
    '<label>职位</label>' +
    '<input name="site_author_title" maxlength="80" value="' + escapeHtml(entity.authorTitle) + '" placeholder="例如：合规顾问" />' +
    '<label>资质说明（写入 Person.description）</label>' +
    '<input name="site_author_credentials" maxlength="200" value="' + escapeHtml(entity.authorCredentials) + '" placeholder="例如：执业律师 10 年" />' +
    '<label>专长领域（逗号分隔，写入 knowsAbout）</label>' +
    '<input name="site_author_expertise" maxlength="200" value="' + escapeHtml(entity.authorExpertise) + '" placeholder="例如：企业合规,数据合规" />' +
    '<label>作者页 / 关于页地址</label>' +
    '<input name="site_author_url" maxlength="300" value="' + escapeHtml(entity.authorUrl) + '" placeholder="/about 或 https://..." />' +
    '</div>' +
    '<div>' +
    '<label>站点 logo 地址（Organization.logo，Google 富结果必需）</label>' +
    '<input name="site_logo_url" maxlength="300" value="' + escapeHtml(entity.logoUrl) + '" placeholder="/media/logo.png 或 https://..." />' +
    '<label>默认分享图（og:image，建议 1200×630）</label>' +
    '<input name="site_og_image" maxlength="300" value="' + escapeHtml(entity.ogImage) + '" placeholder="/media/share.png 或 https://..." />' +
    '<label>官方主页（每行一个，写入 Organization.sameAs）</label>' +
    '<textarea name="site_social_links" rows="4" placeholder="https://weibo.com/xxx&#10;https://www.zhihu.com/org/xxx">' + escapeHtml(entity.socialLinks) + '</textarea>' +
    '</div>' +
    '</div>' +
    '<button class="btn" type="submit">保存署名与实体设置</button>' +
    '</form>'
  const checklistHtml =
    '<div class="card" style="margin-top:16px">' +
    '<h3 style="margin-top:0">上线检查</h3>' +
    '<ul>' +
    '<li>站点主题、行业、核心服务先在「系统设置」填写，GEO 文档会自动读取。</li>' +
    '<li>保持公开服务、城市、已发布文章可访问；不要为了 GEO 把后台、API 或搜索结果页开放给爬虫。</li>' +
    '<li>发布文章后先人工核验事实，再依靠 Sitemap/通知和 AI 可抓取页面进行发现。</li>' +
    '<li>结构化数据只描述页面真实内容；不要虚构评分、评论、价格、资质等字段。</li>' +
    '</ul>' +
    '</div>'
  return renderAdminLayout({
    title: 'GEO / AI 搜索', active: '/admin/geo', siteName: opts.siteName, cspNonce: opts.cspNonce,
    body: '<div class="section-title"><h2>🧭 GEO / AI 搜索</h2><a href="/admin/seo">SEO / 自然收录 →</a></div>' +
      '<div style="margin-bottom:12px">' + tabBar + '</div>' +
      crawlerHtml +
      '<div class="grid grid-3">' +
      '<div class="card">' +
      '<h3 style="margin-top:0">llms.txt</h3>' +
      '<p style="font-size:12px;color:var(--muted);line-height:1.8">动态生成站点主题、服务、城市、最新公开文章、内容可信规则和 Sitemap。建议保持开启，不手工复制整站内容。</p>' +
      '<p><a class="btn secondary" href="/llms.txt" target="_blank">查看 /llms.txt</a></p>' +
      '<span class="badge">' + (opts.llmsEnabled ? '已启用' : '已关闭') + '</span>' +
      '</div>' +
      '<div class="card">' +
      '<h3 style="margin-top:0">AI 爬虫白名单</h3>' +
      '<p style="font-size:12px;color:var(--muted);line-height:1.8">开启后，robots.txt 会显式 Allow 主要 AI/答案引擎爬虫，同时继续禁止 /admin、/api、/healthz、/search。</p>' +
      '<div style="font-size:12px;line-height:1.8">' + crawlers.map((name) => '<code>' + escapeHtml(name) + '</code>').join(' · ') + '</div>' +
      '<p style="margin-top:10px"><a class="btn secondary" href="/robots.txt" target="_blank">查看 robots.txt</a></p>' +
      '<span class="badge">' + (opts.aiCrawlersEnabled ? '已允许' : '仅通用规则') + '</span>' +
      '</div>' +
      '<div class="card">' +
      '<h3 style="margin-top:0">结构化数据</h3>' +
      '<p style="font-size:12px;color:var(--muted);line-height:1.8">模板自动输出 Organization（含 logo / sameAs）、WebSite、WebPage、BreadcrumbList；文章页追加 Article、FAQPage 与 Person 作者；服务页输出 Service，城市页输出 WebPage/City。不要在 AI 提示词里重复生成 JSON-LD。</p>' +
      '<span class="badge">自动输出</span>' +
      '<p style="font-size:12px;margin-top:10px"><a href="/admin/geo/structured-data">校验本站结构化数据 →</a><br /><a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener noreferrer">Google Rich Results Test →</a></p>' +
      '</div>' +
      '</div>' +
      ctrl +
      entityForm +
      checklistHtml
  })
}

export function renderStructuredDataPage(opts: {
  siteUrl: string
  results: Array<{ path: string; status: number; types: string[]; errors: string[]; warnings: string[]; invisibleFaq: string[] }>
  siteName?: string, cspNonce?: string, csrfToken?: string
}): string {
  const totalProblems = opts.results.reduce((sum, r) => sum + r.errors.length + r.invisibleFaq.length, 0)
  const statusCard = totalProblems === 0
    ? '<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">全部页面检查通过。</div>'
    : '<div class="card" style="border-left:4px solid #e5484d;color:#c92a2a;margin-bottom:16px">发现 ' + totalProblems + ' 个问题，见下方各页面。</div>'
  const resultsHtml = opts.results.map((r) => {
    const errorsHtml = r.errors.length
      ? '<div style="color:#c92a2a;font-size:13px;line-height:1.9"><strong>错误</strong><ul>' + r.errors.map((t) => '<li>' + escapeHtml(t) + '</li>').join('') + '</ul></div>'
      : ''
    const invisibleFaqHtml = r.invisibleFaq.length
      ? '<div style="color:#c92a2a;font-size:13px;line-height:1.9"><strong>FAQ 与可见内容不一致</strong><ul>' + r.invisibleFaq.map((t) => '<li>结构化数据中的问题「' + escapeHtml(t) + '」在页面可见正文里找不到</li>').join('') + '</ul></div>'
      : ''
    const warningsHtml = r.warnings.length
      ? '<div style="color:#b45309;font-size:13px;line-height:1.9"><strong>提示</strong><ul>' + r.warnings.map((t) => '<li>' + escapeHtml(t) + '</li>').join('') + '</ul></div>'
      : ''
    return '<div class="card" style="margin-bottom:14px">' +
      '<h3 style="margin-top:0">' + escapeHtml(r.path) + ' <span class="badge">HTTP ' + (r.status || '—') + '</span></h3>' +
      '<p style="font-size:12px;color:var(--muted);margin:6px 0">检测到的类型：' + (r.types.length ? r.types.map((t) => '<code>' + escapeHtml(t) + '</code>').join(' · ') : '无') + '</p>' +
      errorsHtml + invisibleFaqHtml + warningsHtml +
      '</div>'
  }).join('')
  return renderAdminLayout({
    title: '结构化数据校验', active: '/admin/geo', siteName: opts.siteName, cspNonce: opts.cspNonce,
    body: '<div class="section-title"><h2>Structured Data Validation</h2><a href="/admin/geo">&lt;- Return GEO / AI Search</a></div>' +
      '<p class="admin-help">Directly crawl public site pages, parse inline <code>application/ld+json</code>：check JSON valid、required fields complete、FAQ matches page visible content。validator only reads station pages，won\'t access external websites.</p>' +
      statusCard +
      resultsHtml +
      '<div class="card">' +
      '<h3 style="margin-top:0">怎么读懂结果</h3>' +
      '<ul style="font-size:13px;line-height:1.9">' +
      '<li><strong>JSON-LD 解析失败</strong>：整块结构化数据会失效，通常是内容里出现了未转义的 <code>&lt;/script&gt;</code>。本站模板已统一转义，出现即说明某处绕过了 <code>serializeJsonLd</code>。</li>' +
      '<li><strong>缺少 Organization.logo</strong>：到「署名与站点实体」填写 logo 地址。</li>' +
      '<li><strong>FAQ 与可见内容不一致</strong>：结构化数据必须与用户能看到的内容一致，请补上可见问答或清空 FAQ。</li>' +
      '<li>本机校验通过后，建议再用 <a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener noreferrer">Google Rich Results Test</a> 复核一次。</li>' +
      '</ul>' +
      '</div>'
  })
}

export function renderSeoPage(opts: {
  siteUrl: string
  recentLogs: any[]
  successCount: number
  failureCount: number
  engine?: string
  result?: string
  q?: string
  channels?: Record<string, boolean>
  notifyStarted?: boolean
  notifyCount?: number
  siteName?: string, cspNonce?: string, csrfToken?: string
}): string {
  const engine = opts.engine || ''
  const result = opts.result || ''
  const q = opts.q || ''
  const channels = opts.channels || {}
  const isSuccess = (status: number) => status >= 200 && status < 300
  const channelItems: Array<{ key: string; name: string; status: boolean | 'manual'; desc: string }> = [
    { key: 'indexnow', name: 'IndexNow', status: channels.indexnow ?? false, desc: '人工审核并发布后自动通知公开 URL；更新和删除公开 URL 也会通知。' },
    { key: 'bing', name: 'Bing / IndexNow', status: channels.indexnow ?? false, desc: 'Bing 自动 URL 通知使用 IndexNow；不依赖旧的 Bing SOAP/POX 接口。' },
    { key: 'baidu', name: '百度普通收录', status: channels.baidu ?? false, desc: channels.baidu ? '已配置 token，可主动提交发布 URL。' : '未配置 token：继续依靠 sitemap.xml、robots.txt 和站内链接自然发现。' },
    { key: 'google', name: 'Google', status: channels.google ?? false, desc: '普通页面使用 Sitemap + Search Console；不把通用 Indexing API 当普通文章批量提交接口。' },
    { key: '360', name: '360 搜索', status: channels['360'] ?? false, desc: channels['360'] ? '已配置 token，可主动提交发布 URL。' : '未配置 token：继续依靠 sitemap.xml、robots.txt 和站内链接自然发现。' },
    { key: 'sogou', name: '搜狗搜索', status: channels.sogou ?? false, desc: channels.sogou ? '已配置 token，可主动提交发布 URL。' : '未配置 token：继续依靠 sitemap.xml、robots.txt 和站内链接自然发现。' },
    { key: 'baidu-ai', name: '百度 AI 搜索', status: 'manual', desc: '通过公开页面、结构化数据和 AI 搜索站长工具观察抓取、曝光与引用；不把通用 Indexing API 当普通文章批量提交接口。' },
    { key: 'video', name: '国内视频/内容平台', status: 'manual', desc: '人工发布后自动生成抖音、快手、小红书、哔哩哔哩发布包；第三方账号外发仍需按官方授权流程人工发布。' },
  ]
  const channelItemsHtml = channelItems.map((item) => {
    return '<div style="border:1px solid var(--border);border-radius:10px;padding:12px">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">' +
      '<strong>' + item.name + '</strong>' +
      '<span class="badge">' + (item.status ? '已配置' : '未启用/手动提交') + '</span>' +
      '</div>' +
      '<p style="color:var(--muted);font-size:12px;line-height:1.6">' + item.desc + '</p>' +
      '</div>'
  }).join('')
  const engineOptionsHtml = ['indexnow','bing','baidu','360','sogou','google'].map((e) => {
    return '<option value="' + e + '" ' + (engine === e ? 'selected' : '') + '>' + e + '</option>'
  }).join('')
  const resultOptionsHtml = [
    '<option value="" ' + (result === '' ? 'selected' : '') + '>全部</option>',
    '<option value="success" ' + (result === 'success' ? 'selected' : '') + '>成功</option>',
    '<option value="failure" ' + (result === 'failure' ? 'selected' : '') + '>失败</option>'
  ].join('')
  const logsHtml = opts.recentLogs.map((l) => {
    const status = Number(l.status_code || 0)
    const skipped = status === 0 && /(基础模板|不调用|不重复调用|请在|手动)/.test(String(l.response || ''))
    const ok = isSuccess(status) && !skipped
    const deprecated = l.engine === 'google-ping' || l.engine === 'bing-ping'
    return '<tr>' +
      '<td>' + escapeHtml(l.engine) + (deprecated ? ' <span class="badge">历史废弃</span>' : '') + '</td>' +
      '<td style="max-width:320px;word-break:break-all">' + escapeHtml(l.url) + '</td>' +
      '<td>' + (skipped ? '<span class="badge">跳过 / 手动</span>' : ok ? '<span class="badge" style="background:#e7f7ee;color:#1a8a4e">成功</span>' : '<span class="badge" style="background:#fdeaea;color:#e5484d">失败</span>') + '</td>' +
      '<td>' + (status || '-') + '</td>' +
      '<td style="max-width:460px;white-space:pre-wrap;word-break:break-word;font-size:12px">' + escapeHtml(l.response || '') + '</td>' +
      '<td>' + escapeHtml(l.created_at || '') + '</td>' +
      '<td>' + (!ok && !skipped ? '<form method="post" action="/admin/seo/logs/' + l.id + '/retry" style="display:inline;margin-right:6px"><button class="btn secondary" type="submit" onclick="return confirm(\'将这个 URL 重新提交到已配置的自动通知渠道。继续？\')">重试</button></form>' : '') +
      '<form method="post" action="/admin/seo/logs/' + l.id + '/delete" style="display:inline"><button class="btn secondary" type="submit" onclick="return confirm(\'确认删除这条推送日志？\')">删除</button></form>' +
      '</td>' +
      '</tr>'
  }).join('')
  const logsEmptyHtml = opts.recentLogs.length ? '' : '<p style="color:var(--muted)">没有符合条件的推送记录。</p>'
  const notifyHtml = opts.notifyStarted ? '<div style="margin-top:8px;color:#1a8a4e;font-size:12px">已启动收录通知：当前公开 URL ' + escapeHtml(String(opts.notifyCount || 0)) + ' 个；实际接收和后续抓取状态请查看下方推送结果。</div>' : ''
  return renderAdminLayout({
    title: 'SEO / 自然收录', active: '/admin/seo', siteName: opts.siteName, cspNonce: opts.cspNonce, csrfToken: opts.csrfToken,
    body: '<div class="section-title"><h2>SEO / 自然收录</h2><a href="/admin/keywords">统一 SEO 关键词 →</a></div>' +
      '<p style="color:var(--muted);font-size:13px;line-height:1.8">这里负责已发布 URL 的自然发现、抓取和可索引基础。<strong>没有 token 也不等于不能被收录</strong>：网站仍会通过公开的 sitemap.xml、robots.txt 和站内链接让搜索引擎自行发现和抓取；token 只是用于更主动的 URL 提交通知，不能保证立即收录。</p>' +
      '<div class="card" style="margin-bottom:16px">' +
      '<h3 style="margin-top:0">没有 token，怎么被收录？</h3>' +
      '<p style="color:var(--muted);font-size:13px;line-height:1.9;margin-bottom:0">' +
      '<strong>① Sitemap：</strong><a href="/sitemap.xml" target="_blank">' + opts.siteUrl + '/sitemap.xml</a> 只列公开、正常可访问的 SEO URL；' +
      '<strong>② Robots：</strong><a href="/robots.txt" target="_blank">' + opts.siteUrl + '/robots.txt</a> 放行公开内容，并声明 Sitemap；' +
      '<strong>③ 站内链接：</strong>首页 → 城市/服务/文章 → 城市×服务落地页形成可爬链接路径，同时避免链接到低机会分或外站跳转页面；' +
      '<strong>④ 收录通知：</strong>点击下面“通知搜索引擎”后，系统会把当前公开 URL 的变更提交给已配置的 IndexNow/百度/360/搜狗等渠道。' +
      '这些机制可以改善发现与抓取，但不能保证搜索引擎一定收录；Bing 官方也明确说明 IndexNow 不保证抓取或索引，最终是否建立索引由搜索引擎自行判断。' +
      '</p>' +
      '</div>' +
      '<div class="grid grid-4" style="margin-bottom:16px">' +
      '<div class="card"><strong>成功记录</strong><div style="font-size:28px;margin-top:6px;color:#1a8a4e">' + opts.successCount + '</div></div>' +
      '<div class="card"><strong>失败记录</strong><div style="font-size:28px;margin-top:6px;color:#e5484d">' + opts.failureCount + '</div></div>' +
      '<div class="card"><strong>Sitemap</strong><div style="margin-top:6px"><a href="/sitemap.xml" target="_blank">打开 sitemap.xml</a></div><div style="margin-top:6px;color:var(--muted);font-size:12px">Sitemap 不是“收录结果”，只是公开 URL 清单；已发布文章、启用城市/服务及符合机会分条件的落地页才会进入；搜索引擎是否真正收录要看抓取与索引状态。</div></div>' +
      '<div class="card"><strong>Robots</strong><div style="margin-top:6px"><a href="/robots.txt" target="_blank">打开 robots.txt</a></div></div>' +
      '</div>' +
      '<div class="card" style="margin-bottom:16px">' +
      '<h3 style="margin-top:0">搜索引擎渠道</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">' +
      channelItemsHtml +
      '</div>' +
      '</div>' +
      '<div class="card" style="margin-bottom:16px">' +
      '<p><strong>自然收录优先：</strong>发布文章后 URL 会立即进入动态 Sitemap；后台随后异步通知已配置的百度普通收录、IndexNow/Bing，并记录提交日志；Google 普通文章使用 Search Console/Sitemap；不把通用 Indexing API 当普通文章批量提交接口。</p>' +
      '<p style="color:var(--muted);font-size:12px;line-height:1.9;margin-bottom:0">IndexNow Key 文件：' + opts.siteUrl + '/&lt;key&gt;.txt。统一 SEO 关键词：<a href="/admin/keywords">进入固定关键词设置 →</a></p>' +
      '<form method="post" action="/admin/seo/auto-fill" style="display:inline-block;margin:0 8px 8px 0" onsubmit="return confirm(\'仅补齐城市、服务、已发布文章的 SEO 标题、描述和 3-5 个主题词，不修改正文、固定候选词库、Sitemap 或 Robots。继续？\')">' +
      '<button class="btn secondary" type="submit">一键补齐内容页 SEO</button>' +
      '</form>' +
      '<form method="post" action="/admin/seo/submit" style="display:inline-block;margin:0 8px 8px 0" onsubmit="return confirm(\'将当前 Sitemap 中的公开 URL 提交给已配置的搜索引擎通知渠道。通知不等于已经收录。继续？\')">' +
      '<button class="btn" type="submit">📣 通知搜索引擎</button>' +
      '</form>' +
      notifyHtml +
      '<a class="btn secondary" href="/admin/seo">清除查询条件</a>' +
      '</div>' +
      '<div class="card" style="margin-top:16px">' +
      '<h3 style="margin-top:0">推送结果查询</h3>' +
      '<form method="get" action="/admin/seo" class="admin-form" style="display:grid;grid-template-columns:1fr 1fr 2fr auto;gap:10px">' +
      '<div><label>推送渠道</label>' +
      '<select name="engine">' +
      '<option value="">全部</option>' +
      engineOptionsHtml +
      '</select>' +
      '</div>' +
      '<div><label>结果</label>' +
      '<select name="result">' +
      resultOptionsHtml +
      '</select>' +
      '</div>' +
      '<div><label>URL / 返回内容查询</label><input name="q" value="' + escapeHtml(q) + '" placeholder="例如：example.com/article/ 或 429" /></div>' +
      '<button class="btn" type="submit">查询</button>' +
      '</form>' +
      '</div>' +
      '<div class="card" style="margin-top:16px">' +
      '<h3>推送明细</h3>' +
      '<div style="overflow:auto">' +
      '<table>' +
      '<thead><tr><th>渠道</th><th>URL</th><th>结果</th><th>HTTP</th><th>返回内容</th><th>时间</th><th>操作</th></tr></thead>' +
      '<tbody>' +
      logsHtml +
      '</tbody>' +
      '</table>' +
      logsEmptyHtml +
      '</div>' +
      '</div>' +
      '<div class="card" style="margin-top:16px">' +
      '<strong>Google / Sitemap 说明</strong>' +
      '<p style="color:var(--muted);font-size:12px;line-height:1.8;margin-bottom:0">Google 已停止 Sitemap Ping；本系统不再自动调用任何 Sitemap Ping；网站仍然提供 ' + opts.siteUrl + '/sitemap.xml，并建议在 Google Search Console 中提交。Google Indexing API 不能作为普通行业页面的通用提交接口。</p>' +
      '</div>'
  })
}