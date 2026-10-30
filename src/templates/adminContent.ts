/** 后台内容域模板：文章列表 / 表单 / AI 预览，以及采集日志、客户留言与新闻来源。 */
import { escapeHtml } from './layout'
import { renderSafeSvgImage } from './public'
import { parseArticleFaq } from '../utils/articleSchema'
import { renderAdminLayout } from './adminLayout'

export function renderReviewLogsTable(rows: any[]): string {
  return `
    <table>
      <thead><tr><th>文章标题</th><th>动作</th><th>操作者</th><th>备注</th><th>时间</th></tr></thead>
      <tbody>
      ${rows.map((row) => `<tr>
        <td>${escapeHtml(row.title || '')}</td>
        <td>${escapeHtml(row.action || '')}</td>
        <td>${escapeHtml(row.operator || '')}</td>
        <td>${escapeHtml(row.note || '')}</td>
        <td style="font-size:12px;color:var(--muted)">${escapeHtml(row.created_at || '')}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  `;
}

export function renderArticlesList(rows: any[], statusFilter?: string, siteName?: string, cspNonce?: string, csrfToken?: string): string {

  const tabs = [
    { key: '', label: '全部' },
    { key: 'pending_review', label: '待审核' },
    { key: 'published', label: '已发布' },
    { key: 'draft', label: '草稿/已驳回' },
    { key: 'review_logs', label: '审核日志' },
  ]
  const isReviewLogs = statusFilter === 'review_logs'
  return renderAdminLayout({
    title: '内容管理', active: '/admin/articles', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title"><h2>文章管理</h2><a class="btn" href="/admin/articles/new">+ 新建文章</a></div>
    <div style="margin-bottom:12px">
      ${tabs.map((t) => {
        const isActive = (statusFilter || '') === t.key
        const href = '/admin/articles' + (t.key ? '?status=' + t.key : '')
        return `<a class="btn ${isActive ? '' : 'secondary'}" style="margin-right:8px" href="${href}">${t.label}</a>`
      }).join('')}
    </div>
    ${isReviewLogs
      ? renderReviewLogsTable(rows)
      : `<table>
      <thead><tr><th>标题</th><th>前台行业资讯标签</th><th>城市</th><th>状态</th><th>来源</th><th>可信度</th><th>操作</th></tr></thead>
      <tbody>
      ${rows.map((a) => `<tr>
        <td>${escapeHtml(a.title)}</td>
        <td>${escapeHtml(a.category || '-')}</td>
        <td>${escapeHtml(a.city_name || '全国')}</td>
        <td>${statusBadge(a.status)}${a.reject_reason ? `<div style="color:#e5484d;font-size:12px">驳回原因：${escapeHtml(a.reject_reason)}</div>` : ''}</td>
        <td>${a.ai_generated ? `AI采集${a.source_name ? '(' + escapeHtml(a.source_name) + ')' : ''}` : '人工'}</td>
        <td>${a.credibility_score ?? '-'}</td>
        <td>
            <a href="/admin/articles/${a.id}/edit">编辑</a> &nbsp;
            <a href="/admin/articles/${a.id}/preview" target="_blank">预览</a>
            ${a.status === 'published' && a.slug ? ` &nbsp; <a href="/article/${encodeURIComponent(a.slug)}" target="_blank">前台页面</a>` : ''} &nbsp;
            <a href="/admin/articles/${a.id}/wechat" style="color:#07c160">微信排版</a> &nbsp;
            <a href="/admin/articles/${a.id}/social" style="color:#ff2442">多平台分发</a> &nbsp;
            <a href="/admin/articles/${a.id}/versions" style="color:var(--muted)">版本历史</a> &nbsp;
            ${a.status === 'pending_review' ? `
              <form style="display:inline" method="post" action="/admin/articles/${a.id}/approve"><button class="btn" style="padding:2px 10px">审核通过并发布</button></form>
              <form style="display:inline" method="post" action="/admin/articles/${a.id}/reject" onsubmit="return setReason(this)">
                <button class="btn secondary" style="padding:2px 10px">驳回</button>
              </form>
            ` : ''}
            <form style="display:inline" method="post" action="/admin/articles/${a.id}/delete" onsubmit="return confirm('确认删除？删除后不可恢复。')"><button class="btn secondary" style="padding:2px 10px;color:#e5484d" type="submit">删除</button></form>
        </td>
      </tr>`).join('')}
      </tbody>
    </table>
    <script>
      function setReason(form){
        const reason = prompt('请输入驳回原因：', '内容不符合发布标准');
        if(reason === null) return false;
        const input = document.createElement('input');
        input.type='hidden'; input.name='reason'; input.value=reason;
        form.appendChild(input);
        return true;
      }
    </script>`
    }
  `,
  })
}

function statusBadge(status: string) {
  const map: Record<string, string> = { draft: '草稿', pending_review: '待审核', published: '已发布' }
  return `<span class="badge">${map[status] || status}</span>`
}

/** 解析并展示 AI 各维度打分明细；旧数据/人工稿无分项时显示占位说明。 */
function aiScoreBreakdownPanel(a: any): string {
  const raw = a.ai_score_breakdown
  let breakdown: Record<string, number> | null = null
  if (raw) {
    try { breakdown = typeof raw === 'string' ? JSON.parse(raw) : (raw && typeof raw === 'object' ? raw : null) } catch { breakdown = null }
  }
  const total = a.ai_score != null ? Number(a.ai_score) : null
  const rows = breakdown ? [
    ['原创度 originality', breakdown.originality],
    ['事实依据 facts', breakdown.facts],
    ['结构完整 structure', breakdown.structure],
    ['企业实用 utility', breakdown.utility],
    ['SEO/GEO seo_geo', breakdown.seo_geo],
  ] : []
  const scoreColor = (v: number) => v >= 75 ? '#2e7d32' : v >= 50 ? '#ad6800' : '#e5484d'
  const body = breakdown
    ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">
        <thead><tr style="text-align:left;color:var(--muted);font-weight:normal"><th style="padding:4px 6px">维度</th><th style="padding:4px 6px">分数（0-100）</th></tr></thead>
        <tbody>
          ${rows.map(([label, v]) => {
            const num = Number.isFinite(Number(v)) ? Number(v) : 0
            return `<tr><td style="padding:4px 6px">${label}</td>
            <td style="padding:4px 6px"><span style="color:${scoreColor(num)};font-weight:600">${num}</span><span style="color:var(--muted);font-size:11px;margin-left:6px">${scoreLabel(num)}</span></td></tr>`
          }).join('')}
        </tbody>
        ${total != null ? `<tr style="border-top:1px solid #e9ecef"><td style="padding:6px">合成总分</td>
          <td style="padding:6px"><span style="font-weight:700;color:${scoreColor(total)}">${Math.round(total)}</span><span style="color:var(--muted);font-size:11px;margin-left:6px">${scoreLabel(total)}</span></td></tr>` : ''}
      </table>
      <p style="color:var(--muted);font-size:11px;margin:6px 0">加权规则：事实依据 20% · 企业实用 20% · SEO/GEO 30% · 原创度 15% · 结构完整 15%。各分项由 AI 自评，供审核参考。</p>`
    : `<p style="color:var(--muted);font-size:12px;margin:6px 0">该文章暂无分项打分明细（旧版数据或人工撰写）。重新「AI生成 / AI优化 / 重新采集」后会自动补齐 5 个维度的分项分。</p>`
  return `<div class="card" style="margin:10px 0;border-left:4px solid #2e7d32">
    <strong>AI 质量打分明细</strong>${total != null ? ` · 总分 <span style="color:${scoreColor(total)};font-weight:700">${Math.round(total)}</span>` : ''}
    ${body}
  </div>`
}

function scoreLabel(v: number): string {
  if (v >= 90) return '优秀'
  if (v >= 75) return '良好'
  if (v >= 60) return '合格'
  if (v >= 50) return '偏低'
  return '不足'
}

export function renderArticleAiPreview(opts: {
  articleId?: string
  title: string
  slug?: string
  category?: string
  summary?: string
  seoTitle?: string
  seoDescription?: string
  seoKeywords?: string
  coverImage?: string
  aiTitle: string
  aiSummary: string
  aiContent: string
  siteName?: string, cspNonce?: string, csrfToken?: string
}): string {
  const safeId = opts.articleId ? escapeHtml(opts.articleId) : ''
  const saveAction = opts.articleId ? '/admin/articles/' + safeId + '/edit' : '/admin/articles/new'
  const backHref = opts.articleId ? '/admin/articles/' + safeId + '/edit' : '/admin/articles/new'
  const body = [
    "<div class='section-title'><h2>AI 正文生成预览</h2><a href='" + backHref + "'>← 返回编辑</a></div>",
    "<div class='card' style='margin-bottom:16px'>",
    "<p style='margin-top:0;color:var(--muted);font-size:13px'>本页只生成预览，不会直接写入 D1。确认内容后可保存草稿或提交待审核；发布需人工审核。</p>",
    "<p><strong>AI 推荐标题：</strong>" + escapeHtml(opts.aiTitle) + "</p>",
    "<p><strong>AI 推荐摘要：</strong>" + escapeHtml(opts.aiSummary) + "</p>",
    "</div>",
    "<form class='admin-form' method='post' action='" + saveAction + "'>",
    "<input type='hidden' name='from_ai_preview' value='1' />",
    "<input type='hidden' name='title' value='" + escapeHtml(opts.aiTitle || opts.title) + "' />",
    "<input type='hidden' name='slug' value='" + escapeHtml(opts.slug || '') + "' />",
    "<input type='hidden' name='category' value='" + escapeHtml(opts.category || '') + "' />",
    "<input type='hidden' name='summary' value='" + escapeHtml(opts.aiSummary || opts.summary || '') + "' />",
    "<input type='hidden' name='seo_title' value='" + escapeHtml(opts.seoTitle || '') + "' />",
    "<input type='hidden' name='seo_description' value='" + escapeHtml(opts.seoDescription || '') + "' />",
    "<input type='hidden' name='seo_keywords' value='" + escapeHtml(opts.seoKeywords || '') + "' />",
    "<label>封面图（可选，AI 不自动生成图片）</label>","<input name='cover_image' id='cover_image_ai_preview' placeholder='/media/xxx.jpg 或 https://...' value='" + escapeHtml(opts.coverImage || '') + "' />","<p style='font-size:12px;color:var(--muted)'><a href='/admin/media' target='_blank'>打开媒体库上传 →</a></p>",
    "<label>AI 生成正文（可在这里修改后再保存）</label>",
    "<textarea name='content' rows='18'>" + escapeHtml(opts.aiContent) + "</textarea>",
    "<div style='display:flex;gap:10px;flex-wrap:wrap'>",
    "<button class='btn' type='submit' name='status' value='draft'>采用并保存草稿</button>",
    "<button class='btn' type='submit' name='status' value='pending_review'>采用并提交审核</button>",
    "</div></form>"
  ].join('')
  return renderAdminLayout({
    title: 'AI 正文预览',
    active: '/admin/articles',
    siteName: opts.siteName,
    cspNonce: opts.cspNonce,
    csrfToken: opts.csrfToken,
    body,
  })
}

/**
 * FAQ 编辑面板。
 *
 * 这些问答会同时出现在前台「常见问题」区块和 FAQPage 结构化数据里——两者必须一致。
 * 所以这里的输入会原样用于可见内容，不是"只给爬虫看"的隐藏字段：
 * Google 明确要求结构化数据必须有对应的可见内容，不一致会被判定为标记滥用。
 *
 * 字段名带索引（faq_q_0 / faq_a_0）而不是同名重复字段：Hono 的 parseBody 默认对重复键
 * 只保留最后一个值，用 faq_q 重复提交时前面几组会被静默丢掉。索引也允许出现空洞
 * （用户删掉中间某组后不连续），服务端按索引遍历而不是收集。
 */
function faqEditorPanel(faqJson: unknown): string {
  const items = parseArticleFaq(faqJson, 8)
  const rowStyle = 'border:1px solid var(--border);border-radius:10px;padding:10px;margin-top:10px'
  const fields = (q: string, a: string, qNameAttr: string, aNameAttr: string) => `
            <label>问题</label>
            <input ${qNameAttr} maxlength="200" value="${escapeHtml(q)}" placeholder="例如：办理需要准备哪些材料？" />
            <label>答案</label>
            <textarea ${aNameAttr} rows="3" maxlength="1000" placeholder="用一两句话说清结论，避免「视情况而定」这类含糊表述。">${escapeHtml(a)}</textarea>`
  const removeButton = '<button class="btn secondary" type="button" onclick="this.closest(\'.faq-row\').remove()" style="margin-top:6px">删除这一组</button>'
  const rows = items.map((item, index) => `
          <div class="faq-row" data-faq-index="${index}" style="${rowStyle}">
            ${fields(item.q, item.a, `name="faq_q_${index}"`, `name="faq_a_${index}"`)}
            ${removeButton}
          </div>`).join('')
  const templateRow = `
          <div class="faq-row" data-faq-index="" style="${rowStyle}">
            ${fields('', '', 'data-faq-name="faq_q"', 'data-faq-name="faq_a"')}
            ${removeButton}
          </div>`
  return `
      <div class="card" style="margin:12px 0;border-left:4px solid #0ca678">
        <strong>❓ 文章问答（FAQ）· GEO 收录关键项</strong>
        <p style="color:var(--muted);font-size:12px;margin:6px 0;line-height:1.8">
          填写后，前台文章页会出现「常见问题」区块，同时输出 <code>FAQPage</code> 结构化数据。
          AI 搜索（ChatGPT、Perplexity、Google AI 概览）最常直接引用这种一问一答结构。<br />
          <strong>问答必须与页面可见内容一致</strong>：这里填什么，前台就显示什么。没有真实问答就留空，不要为了收录而编造。
        </p>
        <input type="hidden" name="faq_editor" value="1" />
        <div id="faqRows">${rows}</div>
        <button class="btn secondary" type="button" id="faqAddBtn" style="margin-top:10px">+ 添加一组问答</button>
        <span style="color:var(--muted);font-size:12px;margin-left:8px">最多 8 组</span>
        <template id="faqRowTemplate">${templateRow}
        </template>
        <script>
        (function () {
          var button = document.getElementById('faqAddBtn');
          var template = document.getElementById('faqRowTemplate');
          var container = document.getElementById('faqRows');
          if (!button || !template || !container) return;
          // 下一组索引取「已有最大索引 + 1」。不能直接用子元素个数：
          // 删掉中间某组后个数会变小，复用索引会让新旧两组的字段名撞车（后者覆盖前者）。
          var nextIndex = 0;
          Array.prototype.forEach.call(container.querySelectorAll('[data-faq-index]'), function (row) {
            var n = parseInt(row.getAttribute('data-faq-index'), 10);
            if (!isNaN(n) && n >= nextIndex) nextIndex = n + 1;
          });
          button.addEventListener('click', function () {
            if (container.children.length >= 8) { alert('最多 8 组问答。'); return; }
            var fragment = template.content.cloneNode(true);
            var row = fragment.querySelector('.faq-row');
            row.setAttribute('data-faq-index', String(nextIndex));
            Array.prototype.forEach.call(row.querySelectorAll('[data-faq-name]'), function (field) {
              field.name = field.getAttribute('data-faq-name') + '_' + nextIndex;
              field.removeAttribute('data-faq-name');
            });
            nextIndex += 1;
            container.appendChild(fragment);
          });
        })();
        </script>
      </div>`
}

export function renderArticleForm(article?: any, error = '', siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const a = article || { title: '', slug: '', category: '', summary: '', content: '', status: 'draft', city_id: '', seo_title: '', seo_description: '', seo_keywords: '', faq_json: '' }
  return renderAdminLayout({
    title: article ? '编辑文章' : '新建文章', active: '/admin/articles', siteName, cspNonce, csrfToken,
    body: `
    <h2>${article ? '编辑文章' : '新建文章'}</h2>
    ${error ? '<div class="card" style="border-left:4px solid #e5484d;color:#c92a2a;margin:12px 0">' + escapeHtml(error) + '</div>' : ''}
    ${article ? `<div class="article-public-link card" style="margin:12px 0;background:#f8fbff;border-color:#dbe7f5">
      <strong>前台页面</strong>
      ${a.status === 'published'
        ? (() => {
            const publicKey = String(a.slug || '').trim() || String(a.id)
            return '<a href="/article/' + encodeURIComponent(publicKey) + '" target="_blank" rel="noopener noreferrer">/article/' + escapeHtml(publicKey) + ' ↗ 查看前台页面</a>'
          })()
        : '<span style="color:var(--muted);font-size:12px">当前文章还没有已发布的前台页面。</span>'}
    </div>` : ''}
    ${a.card_svg ? `<div class="card" style="max-width:320px;margin-bottom:12px">${renderSafeSvgImage(a.card_svg)}</div>` : ''}
    <form id="articleImageUploadForm" method="post" action="/admin/articles/image-upload-page" enctype="multipart/form-data" target="_blank" hidden></form>
    <form class="admin-form" method="post" action="${article ? `/admin/articles/${article.id}/edit` : '/admin/articles/new'}">
      <input name="title" placeholder="标题" value="${escapeHtml(a.title)}" required />
      <input name="slug" placeholder="URL别名 (留空自动生成)" value="${escapeHtml(a.slug)}" />
      <div class="card" style="margin:12px 0;border-left:4px solid var(--primary)">
        <strong>📌 前台行业资讯标签（可直接修改）</strong>
        <p style="color:var(--muted);font-size:12px;margin:6px 0">这个标签就是前台「行业资讯」文章顶部显示的标签。修改后点击“保存”，前台立即使用新标签。</p>
        <label style="margin-top:8px">前台行业资讯标签</label>
        <input name="category" list="article-tags" placeholder="例如：政策解读、业务知识、企业咨询、业务资料指南" value="${escapeHtml(a.category)}" />
      </div>
      <datalist id="article-tags"><option value="政策解读"></option><option value="业务知识"></option><option value="企业咨询"></option><option value="业务资料指南"></option><option value="服务指南"></option><option value="企业合规"></option><option value="行业资讯"></option><option value="常见问题"></option></datalist>

      <div class="card" style="margin:12px 0;border-left:4px solid #7048e8">
        <strong>🖼️ 封面图 / 配图</strong>
        <p style="color:var(--muted);font-size:12px;margin:6px 0">支持填写 R2/HTTPS 图片地址；也可以先在媒体库上传图片，再复制地址到这里。AI 负责正文和 SEO，图片仍由人工选择。</p>
        <label style="margin-top:8px">封面图地址 cover_image</label>
        <input name="cover_image" id="cover_image_input" placeholder="/media/your-image.jpg 或 https://..." value="${escapeHtml(a.cover_image || "")}" />
        <div id="cover_preview_wrap" style="margin-top:10px;${a.cover_image ? '' : 'display:none'}">
          <img id="cover_preview" src="${escapeHtml(a.cover_image || "")}" alt="封面预览" style="max-width:280px;max-height:160px;border-radius:8px;border:1px solid #e9ecef;object-fit:cover" onerror="this.style.display='none'" />
        </div>
        <p style="font-size:12px;color:var(--muted);margin-top:8px">
          <a href="/admin/media" target="_blank" rel="noopener">打开媒体库上传 →</a>
          <span style="color:var(--muted)">上传 JPG/PNG/WEBP/GIF 后复制地址即可。</span>
        </p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
          <input type="file" name="file" form="articleImageUploadForm" accept="image/jpeg,image/png,image/webp,image/gif" required />
          <button class="btn secondary" type="submit" form="articleImageUploadForm">⬆ 直接上传图片</button>
          <span style="font-size:12px;color:var(--muted)">上传成功页可一键复制封面地址或正文配图 HTML。</span>
        </div>
      </div>
      <textarea name="summary" placeholder="摘要" rows="2">${escapeHtml(a.summary)}</textarea>
      ${faqEditorPanel(a.faq_json)}
      <textarea name="content" placeholder="正文内容（支持HTML）；留空后保存会自动由 Workers AI 生成，也可以先点下方“AI生成预览”检查后再保存" rows="10">${escapeHtml(a.content)}</textarea>
      <select name="status">
        <option value="draft" ${a.status === 'draft' ? 'selected' : ''}>草稿</option>
        <option value="pending_review" ${a.status === 'pending_review' ? 'selected' : ''}>待审核</option>
        <option value="published" ${a.status === 'published' ? 'selected' : ''}>已发布</option>
      </select>
      <div class="card" style="margin-top:10px">
        <strong>SEO由「关键词管理」统一设置</strong>
        <p style="color:var(--muted);font-size:12px;margin:6px 0">文章保存或 AI 生成时自动整理 SEO 标题、描述和主题词；AI 生成结果先进入待审核，不会绕过人工审核自动公开。</p>
      </div>
      ${a.ai_generated && a.ai_score != null ? aiScoreBreakdownPanel(a) : ''}
      <input type="hidden" name="article_id" value="${article ? escapeHtml(article.id) : ''}" />
      <button class="btn" type="submit">保存</button>
      ${article ? '<button class="btn" type="button" onclick="document.getElementById(\'publishArticleForm\').submit()">发布并生成前台页面</button>' : ''}
      <button class="btn secondary" type="submit" formaction="/admin/articles/ai-publish" formmethod="post">🤖 AI生成正文+SEO并进入待审核</button>
      <button class="btn secondary" type="submit" formaction="/admin/articles/ai-preview" formmethod="post">正文留空：生成预览</button>
      <span style="color:var(--muted);font-size:12px;margin-left:8px">AI 生成结果先进入待审核；审核后可点击“发布并生成前台页面”。</span>
    </form>
    ${article ? `<form class="admin-form" method="post" action="/admin/articles/${article.id}/ai-optimize" style="margin-top:10px"><button class="btn secondary" type="submit" onclick="return confirm('使用 Workers AI 优化当前文章正文？原文章链接会保留。')">🤖 AI优化当前文章</button><span style="color:var(--muted);font-size:12px;margin-left:8px">AI优化不会直接公开；审核确认后可点击上面的发布按钮。</span></form>` : ''}
    ${article ? `<form id="publishArticleForm" method="post" action="/admin/articles/${article.id}/publish" style="margin-top:10px"><span style="color:var(--muted);font-size:12px">发布会自动补齐 slug、正文（为空时尝试 AI 生成）、SEO 和内容卡，并直接打开前台页面。</span></form>` : ''}

    <form method="post" action="/admin/articles/${article ? article.id : 'new'}/content/delete" onsubmit="return confirm('确认删除这篇文章内容？删除后不可恢复。')" style="margin-top:10px">${article ? '<button class="btn secondary" type="submit">删除文章内容</button>' : ''}</form>
  `,
  })
}

export function renderCollectionLogsList(rows: any[], message = '', siteName?: string, cspNonce?: string, csrfToken?: string): string {
  return renderAdminLayout({
    title: '采集任务日志', active: '/admin/news-sources', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <h2>新闻采集任务运行日志</h2>
      <div class="admin-actions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <a class="btn secondary" href="/admin/news-sources">← 返回采集源管理</a>
        <form method="post" action="/admin/collection-logs/delete-all" style="display:inline">
          <button class="btn danger" type="submit" onclick="return confirm('确认一键删除全部采集日志？删除后不可恢复。')">🗑 一键删除全部日志</button>
        </form>
      </div>
    </div>
    ${message ? `<div class="card" style="border-left:4px solid #1a8a4e;margin-bottom:16px">${escapeHtml(message)}</div>` : ''}
    <table>
      <thead><tr><th>来源</th><th>抓取条数</th><th>新建文章</th><th>已发布</th><th>错误</th><th>时间</th><th>操作</th></tr></thead>
      <tbody>
      ${rows.map((l) => `<tr>
        <td>${escapeHtml(l.source_name || '')}</td><td>${l.fetched_count}</td><td>${l.created_count}</td><td>${l.published_count}</td>
        <td style="color:#e5484d">${escapeHtml(l.error || '')}</td><td>${escapeHtml(l.created_at)}</td>
        <td><form method="post" action="/admin/collection-logs/${l.id}/delete" style="display:inline"><button class="btn secondary" type="submit" onclick="return confirm('确认删除这条采集日志？删除后不可恢复。')">删除日志</button></form></td>
      </tr>`).join('')}
      </tbody>
    </table>
  `,
  })
}

export function renderMessagesList(rows: any[], statusFilter?: string, message = '', siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const tabs = [
    { key: '', label: '全部' },
    { key: 'new', label: '未读' },
    { key: 'replied', label: '已回复' },
    { key: 'read', label: '已读' },
  ]
  const statusLabel = (status: string) => {
    if (status === 'new') return '<span class="badge" style="background:#fff7e6;color:#ad6800">未读</span>'
    if (status === 'replied') return '<span class="badge" style="background:#e7f7ee;color:#1a8a4e">已回复</span>'
    return '<span class="badge">已读</span>'
  }
  const replyCount = (m: any) => Array.isArray(m.replies) ? m.replies.length : Number(m.reply_count || 0)
  const replyHtml = (m: any) => {
    const replies = Array.isArray(m.replies) ? m.replies : []
    return replies.length
      ? `
        <div style="margin:10px 0 14px;padding:10px 12px;background:var(--surface-2,#f8fafc);border-radius:8px">
          <strong style="font-size:13px">回复记录（${replies.length}）</strong>
          ${replies.map((r: any) => `
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
              <div style="font-size:12px;color:var(--muted)">${escapeHtml(r.created_at || '')} · ${escapeHtml(r.operator || '管理员')} · ${escapeHtml(r.channel || '内部记录')}</div>
              <div style="white-space:pre-wrap;line-height:1.7;margin-top:4px">${escapeHtml(r.content || '')}</div>
            </div>`).join('')}
        </div>`
      : '<p style="margin:8px 0;color:var(--muted);font-size:12px">暂无回复记录。</p>'
  }
  return renderAdminLayout({
    title: '客户留言', active: '/admin/messages', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title"><h2>客户留言</h2><span style="color:var(--muted);font-size:12px">回复会保存到留言线程，并记录用哪种方式联系了客户。站内不代发邮件；需要邮件回复时点「用本机邮件客户端回复」走你自己的邮箱。</span></div>
    ${message ? `<div class="card" style="border-left:4px solid #1a8a4e;margin-bottom:12px;color:#1a8a4e">${escapeHtml(message)}</div>` : ''}
    <div style="margin-bottom:12px">
      ${tabs.map((t) => `<a class="btn ${(statusFilter || '') === t.key ? '' : 'secondary'}" style="margin-right:8px;margin-bottom:6px" href="/admin/messages${t.key ? '?status=' + t.key : ''}">${t.label}</a>`).join('')}
    </div>
    ${rows.map((m) => `
      <div class="card" style="margin:12px 0">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
          <div style="min-width:0;flex:1">
            <div style="font-weight:700;font-size:16px">${escapeHtml(m.name || '未填写姓名')}</div>
            <div style="margin-top:5px;color:var(--muted);font-size:12px">
              电话：${escapeHtml(m.phone || '-')} · 邮箱：${escapeHtml(m.email || '-')} · 城市：${escapeHtml(m.city || '-')} · 服务：${escapeHtml(m.service || '-')}
              ${m.utm_source ? `<span style="color:#1557a8"> · 来源：${escapeHtml(String(m.utm_source || '') + (m.utm_medium ? ' / ' + m.utm_medium : '') + (m.utm_campaign ? ' / ' + m.utm_campaign : ''))}</span>` : ''}
            </div>
          </div>
          <div>${statusLabel(String(m.status || 'new'))}</div>
        </div>
        <div style="margin-top:12px;padding:12px;background:var(--surface-2,#f8fafc);border-radius:8px">
          <div style="font-size:12px;color:var(--muted)">客户留言 · ${escapeHtml(m.created_at || '')}</div>
          <div style="white-space:pre-wrap;line-height:1.8;margin-top:5px">${escapeHtml(m.content || '')}</div>
        </div>
        ${replyHtml(m)}
        <details style="margin-top:10px">
          <summary style="cursor:pointer;font-weight:600">${replyCount(m) ? '继续回复（已有 ' + replyCount(m) + ' 条）' : '回复客户'}</summary>
          <form method="post" action="/admin/messages/${m.id}/reply" class="admin-form" style="margin-top:10px">
            <label>回复方式（仅记录用哪种方式联系了客户）</label>
            <select name="channel">
              <option value="电话">电话</option>
              <option value="微信">微信</option>
              <option value="QQ">QQ</option>
              <option value="其他">其他</option>
              <option value="内部记录">内部记录</option>
            </select>
            <label>回复内容</label>
            <textarea name="content" rows="4" maxlength="3000" required placeholder="填写准备回复客户的内容，会保存到留言回复记录。"></textarea>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${m.email ? `<a class="btn secondary" href="mailto:${escapeHtml(m.email)}">✉️ 用本机邮件客户端回复</a>` : ''}${m.phone ? `<a class="btn secondary" href="tel:${escapeHtml(m.phone)}">📞 拨打电话</a>` : ''}
              <button class="btn" type="submit">保存回复并标记为已回复</button>
            </div>
          </form>
        </details>
        <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
          ${m.status === 'new' ? `<form method="post" action="/admin/messages/${m.id}/read" style="display:inline"><button class="btn secondary" type="submit">标记已读</button></form>` : ''}
          <form method="post" action="/admin/messages/${m.id}/delete" style="display:inline" onsubmit="return confirm('确认删除该留言及其全部回复？删除后不可恢复。')"><button class="btn secondary" type="submit" style="color:#e5484d">删除留言及回复</button></form>
        </div>
      </div>`).join('')}
    ${rows.length ? '' : '<div class="card" style="color:var(--muted)">当前筛选条件下没有客户留言。</div>'}
  `,
  })
}

export function renderNewsSourcesList(rows: any[], collectedArticles: any[] = [], message = '', schedule: { enabled: boolean; time: string } = { enabled: false, time: '08:00' }, qualityMin: number = 65, roundItems: number = 1, autoPublish: boolean = false, siteName?: string, cspNonce?: string, csrfToken?: string): string {
  return renderAdminLayout({
    title: '新闻采集管理', active: '/admin/news-sources', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title"><h2>新闻采集管理</h2><div>
      <a href="/admin/collection-logs">查看采集日志 →</a>
      <form method="post" action="/admin/news-sources/collect" style="display:inline;margin-left:8px"><button class="btn" type="submit">🤖 立即采集并生成待审核 AI 解读稿</button></form>
    </div></div>
    ${message ? `<div class="card" style="border-left:4px solid ${message.startsWith('本轮') || message.startsWith('新闻采集完成') || message.startsWith('已创建') ? '#1a8a4e' : '#e5484d'};margin-bottom:16px">${escapeHtml(message)}</div>` : ''}
    <div class="card" style="margin:12px 0">
      <strong>新闻采集任务运行规则</strong>
      <p style="color:var(--muted);font-size:13px;line-height:1.8;margin:6px 0 0">
        每个采集来源都可以填写<strong>不同的来源地址</strong>；来源地址可以是 RSS / Atom / JSON 接口，也可以直接填写新闻网站的<strong>HTML 列表页地址</strong>。
        系统先抓来源地址；如果普通解析识别不到候选，自动让 AI 分析已抓取的列表页快照，识别标题、真实链接和页面证据，再进入原文页面读取资料。AI 只负责整理和独立解读，不直接转载原文；无法确认的链接不会被编造。
        原文章链接会保留在正文中。AI内容先通过标题、结构、事实边界、实际影响、执行步骤、风险提醒和 SEO 主题词等质量门槛；通过后统一进入 pending_review，必须由管理员人工审核后才能公开。
      </p>
    </div>
    <div class="card" style="margin:12px 0">
      <strong>定时采集任务</strong>
      <form method="post" action="/admin/news-sources/auto-publish" class="admin-form" style="margin-top:10px">
        <h3 style="margin:0 0 6px">自动发布(默认关闭)</h3>
        <p style="font-size:12px;color:var(--muted);line-height:1.8">开启后,同时满足三个条件的采集文章会直接公开:① 质量分不低于「news_quality_min」;② GEO 体检全部通过;③ 本开关开启。任一不满足仍进入人工审核。公开内容仍可在内容管理中下架。</p>
        <label style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="news_auto_publish" ${autoPublish ? 'checked' : ''} /> 满足三道闸时自动发布采集文章</label>
        <button class="btn secondary" type="submit" style="margin-top:8px">保存自动发布设置</button>
      </form>
      <form method="post" action="/admin/news-sources/schedule" class="admin-form" style="margin-top:10px">
        <label><input type="checkbox" name="enabled" ${schedule.enabled ? 'checked' : ''} /> 启用定时新闻采集 + AI整理</label>
        <label>每天北京时间</label>
        <input type="time" name="collection_time" value="${escapeHtml(schedule.time || '08:00')}" step="300" required />
        <p style="color:var(--muted);font-size:12px;margin:0">按 5 分钟一个时间点设置，例如 08:00、08:05、12:30、18:30。保存后由 Cloudflare Cron 自动执行；每次采集都只生成待审核稿，不会自动公开。管理员审核通过后再手动发布。</p>
        <button class="btn" type="submit">保存定时任务时间</button>
      </form>
    </div>
    <div class="card" style="margin:12px 0">
      <strong>AI 内容质量门槛（SEO/GEO 收录）</strong>
      <form method="post" action="/admin/news-sources/quality" class="admin-form" style="margin-top:10px">
        <label>最低 AI 质量分（0-100，当前 ${qualityMin}）</label>
        <input type="number" name="news_quality_min" min="0" max="100" step="5" value="${qualityMin}" required />
        <p style="color:var(--muted);font-size:12px;margin:0;line-height:1.7">
          AI 生成/采集的内容质量分低于该值会被拦截，不进入待审核。
          提高门槛 → 内容更利于 SEO/GEO 收录但产出更少；降低门槛 → 产出多但需人工更仔细审核。
          默认 65；建议 60-80 之间调整。保存后下一轮采集立即生效。
        </p>
        <button class="btn" type="submit">保存质量门槛</button>
      </form>
    </div>
    <div class="card" style="margin:12px 0">
      <strong>每轮采集条数（覆盖面 vs CPU）</strong>
      <form method="post" action="/admin/news-sources/round-items" class="admin-form" style="margin-top:10px">
        <label>每个来源每轮处理多少条（1-5，当前 ${roundItems}）</label>
        <input type="number" name="news_round_items" min="1" max="5" step="1" value="${roundItems}" required />
        <p style="color:var(--muted);font-size:12px;margin:0;line-height:1.7">
          默认 1 条最省 Workers AI CPU，适合 Cloudflare Free 计划；调高可扩大采集覆盖面，但会显著增加每轮 AI 调用次数。
          建议先保持 1，确有较多来源需要覆盖时再提到 2-3。保存后下一轮采集立即生效。
        </p>
        <button class="btn" type="submit">保存每轮条数</button>
      </form>
    </div>
    <div class="card" style="margin:12px 0">
      <strong>“继续提交创建”怎么用？</strong>
      <span style="color:var(--muted);font-size:13px">已经采集过的文章不会被系统重复自动创建。需要再次利用某条已采集内容时，点击下面的“继续提交创建”，系统会复制为一篇新的草稿，进入「内容管理」继续编辑、AI优化或发布，不删除原文章。</span>
    </div>
    <form class="admin-form" method="post" action="/admin/news-sources/new">
      <input name="name" placeholder="来源名称，如：国家业务总局" required />
      <label>来源地址（每个来源可使用不同的新闻列表页地址）</label>
      <input name="feed_url" type="url" placeholder="https://example.com/news 或 RSS/JSON 地址" required />
      <select name="credibility"><option>高</option><option selected>中</option><option>低</option></select>
      <button class="btn" type="submit">添加来源</button>
    </form>
    <table style="margin-top:16px">
      <thead><tr><th>来源</th><th>来源地址 / 列表页</th><th>可信度</th><th>上次抓取</th><th>操作</th></tr></thead>
      <tbody>
      ${rows.map((s) => `<tr>
        <td>${escapeHtml(s.name)}</td>
        <td style="max-width:360px;word-break:break-all"><a href="${escapeHtml(s.feed_url)}" target="_blank" rel="nofollow noopener">${escapeHtml(s.feed_url)}</a></td>
        <td>${escapeHtml(s.credibility)}</td>
        <td>${escapeHtml(s.last_fetched_at || '未抓取')}</td>
        <td>
          <form method="post" action="/admin/news-sources/${s.id}/collect" style="display:inline"><button class="btn secondary" type="submit">立即抓取</button></form>
          <form method="post" action="/admin/news-sources/${s.id}/analyze" style="display:inline;margin-left:6px"><button class="btn secondary" type="submit">🤖 AI分析来源</button></form>
          &nbsp;<a href="/admin/news-sources/${s.id}/edit">修改内容链接</a>
          &nbsp;<form method="post" action="/admin/news-sources/${s.id}/delete" style="display:inline" onsubmit="return confirm('确认删除这个采集源？相关已采集文章不会删除。' )"><button class="btn secondary" style="padding:2px 10px;color:#e5484d" type="submit">删除</button></form>
        </td>
      </tr>`).join('')}
      </tbody>
    </table>
    <div class="card" style="margin-top:18px">
      <h3>已采集文章</h3>
      <p style="color:var(--muted);font-size:12px">这里列出 AI 新闻采集产生的独立解读文章。通过质量门槛后进入 pending_review，必须人工审核并明确发布；原文章只作为事实来源，原文章链接保留在内容里。</p>
      <table><thead><tr><th>标题</th><th>来源</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>
      ${collectedArticles.map((a) => `<tr>
        <td>${escapeHtml(a.title)}</td>
        <td>${a.source_name ? '<a href="' + escapeHtml(a.source_url || '') + '" target="_blank" rel="nofollow noopener">' + escapeHtml(a.source_name) + '</a>' : '-'}</td>
        <td>${statusBadge(a.status || '')}</td>
        <td>${escapeHtml(a.created_at || '')}</td>
        <td>
          ${a.status === 'published' ? `<a href="/article/${encodeURIComponent(a.slug || String(a.id))}" target="_blank">查看前台</a> &nbsp;` : ''}
          <a href="/admin/articles/${a.id}/edit">编辑文章</a> &nbsp;\n          <a href="/admin/articles/${a.id}/preview" target="_blank">后台预览</a> &nbsp;
          <form method="post" action="/admin/news-sources/articles/${a.id}/recreate" style="display:inline"><button class="btn secondary" type="submit" onclick="return confirm('将根据这篇已采集文章创建一篇新的草稿，原文章不会改变。确认继续？')">继续提交创建</button></form>
          &nbsp;<form method="post" action="/admin/articles/${a.id}/delete" style="display:inline" onsubmit="return confirm('确认删除这篇采集文章？')"><button class="btn secondary" style="padding:2px 10px;color:#e5484d" type="submit">删除</button></form>
        </td>
      </tr>`).join('')}
      </tbody></table>
    </div>
  `,
  })
}
