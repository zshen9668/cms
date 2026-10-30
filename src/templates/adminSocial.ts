/** 后台分发域模板：微信排版预览与国内平台内容分发。 */
import { escapeHtml } from './layout'
import type { PlatformConfig } from '../utils/socialPlatforms'
import { renderAdminLayout, sanitizeAdminPreviewHtml } from './adminLayout'
export function renderWechatEditor(article: any, cityName: string, wechatHtml: string, siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const statusLabel: Record<string, string> = {
    not_synced: '未生成', ready: '已生成', copied: '已复制', scheduled: '已排期（手动提醒）',
  }
  const scheduledValue = article.wechat_scheduled_at ? String(article.wechat_scheduled_at).slice(0, 16) : ''
  return renderAdminLayout({
    title: '微信排版', active: '/admin/articles', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <h2>微信排版 · ${escapeHtml(article.title)}</h2>
      <a href="/admin/articles" style="color:var(--muted);font-size:13px">← 返回内容管理</a>
    </div>
    <p style="color:var(--muted);font-size:13px;margin-bottom:20px">
      当前状态：<span class="badge">${statusLabel[article.wechat_status] || '未生成'}</span>
      　尚未接入微信公众号 API，这里生成排版内容供"一键复制"到公众号图文编辑器手动粘贴发布；
      预约时间只作为你自己安排用的提醒，不会自动发布，接入方式见代码注释（<code>utils/wechatFormat.ts</code>）。
    </p>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
      <div>
        <form class="admin-form" method="post" action="/admin/articles/${article.id}/wechat">
          <label>微信标题（留空则用官网标题：${escapeHtml(article.title)}）</label>
          <input name="wechat_title" value="${escapeHtml(article.wechat_title || '')}" />

          <label>微信摘要（建议120字以内，公众号列表页展示用，留空则用官网摘要）</label>
          <textarea name="wechat_summary" rows="2" placeholder="${escapeHtml(article.summary || '')}">${escapeHtml(article.wechat_summary || '')}</textarea>

          <label>封面图片地址（微信要求真实图片URL；建议先传到公众号"素材库"或图床，再把地址粘贴到这里；暂不支持在此直接上传）</label>
          <input name="wechat_cover_url" value="${escapeHtml(article.wechat_cover_url || '')}" placeholder="https://..." />

          <label>预约发布时间（仅供自己提醒，不会自动发布）</label>
          <input type="datetime-local" name="wechat_scheduled_at" value="${escapeHtml(scheduledValue)}" />

          <button class="btn" type="submit">保存并生成排版</button>
        </form>

        <div class="card" style="margin-top:16px">
          <h3 style="margin-top:0">SEO关键词 / 城市标签（只读，来自"编辑文章"页的SEO设置）</h3>
          <p style="font-size:13px;color:var(--muted);margin:6px 0">城市标签：${escapeHtml(cityName)}</p>
          <p style="font-size:13px;color:var(--muted);margin:6px 0">
            关键词：${article.seo_keywords ? escapeHtml(article.seo_keywords) : '未设置，可回到「编辑文章」页补充'}
          </p>
        </div>
      </div>

      <div>
        <h3 style="margin-top:0">预览（下面的内容就是复制后粘贴到公众号编辑器的效果）</h3>
        ${article.wechat_cover_url ? `<img src="${escapeHtml(article.wechat_cover_url)}" style="width:100%;border-radius:8px;margin-bottom:12px;display:block" />` : ''}
        <div id="wechatPreview" class="card" style="max-height:460px;overflow:auto">
          ${sanitizeAdminPreviewHtml(wechatHtml)}
        </div>
        <button class="btn" style="margin-top:12px;background:#07c160" onclick="copyWechatContent()">✅ 一键复制（可直接粘贴到公众号编辑器）</button>
        <p style="font-size:12px;color:var(--muted);margin-top:8px">复制的是正文排版；标题、摘要、封面微信要求分别填在编辑器对应的输入框里，无法通过粘贴一起带过去。</p>
      </div>
    </div>

    <script>
    function copyWechatContent(){
      const el = document.getElementById('wechatPreview');
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try {
        document.execCommand('copy');
        fetch(window.location.pathname + '/mark-copied', { method: 'POST' }).catch(function(){});
        alert('已复制！打开公众号后台的图文消息编辑器，光标点进正文区域后 Ctrl+V / Cmd+V 粘贴即可。');
      } catch (e) {
        alert('复制失败，请手动选中预览区域内容后按 Ctrl+C');
      }
      sel.removeAllRanges();
    }
    </script>
  `,
  })
}

const STATUS_LABEL: Record<string, string> = {
  not_synced: '未生成', ready: '已生成', copied: '已复制', scheduled: '已排期（手动提醒）',
}

// ---- 多平台分发汇总页：一个文章对应抖音/快手/小红书/哔哩哔哩四张卡片 ----
export function renderSocialHub(article: any, platforms: PlatformConfig[], posts: Record<string, any>, siteName?: string, cspNonce?: string, csrfToken?: string): string {
  return renderAdminLayout({
    title: '多平台分发', active: '/admin/articles', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <h2>多平台分发 · ${escapeHtml(article.title)}</h2>
      <a href="/admin/articles" style="color:var(--muted);font-size:13px">← 返回内容管理</a>
    </div>
    <p style="color:var(--muted);font-size:13px;margin-bottom:20px">
      国内内容/视频平台默认生成“发布包”：AI生成标题、正文/口播、话题与必要排版，保存到 CMS 后再按平台官方授权方式发布；模板不保存平台账号密码，也不在未授权情况下代发。
      微信排版是独立入口，见内容管理列表里的"微信排版"链接。
    </p>
    <div class="grid grid-4">
      ${platforms.map((p) => {
        const post = posts[p.key]
        const status = post?.status || 'not_synced'
        return `
        <a class="card" href="/admin/articles/${article.id}/social/${p.key}" style="border-top:3px solid ${p.color}">
          <h3>${p.icon} ${p.label}</h3>
          <p style="margin-top:8px"><span class="badge">${STATUS_LABEL[status]}</span></p>
          <p style="margin-top:8px;color:var(--muted);font-size:12px">${escapeHtml(p.helpText)}</p>
        </a>`
      }).join('')}
    </div>
    <script>
    document.querySelectorAll('.prompt-var-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        const target = document.getElementById(btn.getAttribute('data-target') || '');
        if (!target) return;
        const value = btn.getAttribute('data-value') || '';
        const start = target.selectionStart == null ? target.value.length : target.selectionStart;
        const end = target.selectionEnd == null ? target.value.length : target.selectionEnd;
        target.value = target.value.slice(0, start) + value + target.value.slice(end);
        target.focus();
        const pos = start + value.length;
        target.setSelectionRange(pos, pos);
      });
    });
    </script>
  `,
  })
}

// ---- 单平台编辑/预览/复制页 ----
export function renderSocialSettingsPage(settings: Record<string, string>, platforms: PlatformConfig[], siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const saved = String((settings as any).__social_saved || '') === '1'
  const error = String((settings as any).__social_error || '')
  return renderAdminLayout({
    title: '社交平台入口设置', active: '/admin/social', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <div><h2>⚙️ 社交平台入口设置</h2><p style="margin:4px 0 0;color:var(--muted);font-size:13px">只保存平台官方创作/发布入口地址，不保存账号密码，也不会自动代发。</p></div>
      <a href="/admin/social">← 返回内容分发</a>
    </div>
    ${error ? '<div class="card" style="border-left:4px solid #e5484d;color:#c92a2a;margin-bottom:16px">' + escapeHtml(error) + '</div>' : ''}
    ${saved ? '<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">平台入口设置已保存。</div>' : ''}
    <form class="admin-form" method="post" action="/admin/social/settings" style="max-width:none">
      ${platforms.map((p) => {
        const value = String(settings['social_entry_' + p.key] || '')
        return `
        <div class="card" style="margin-bottom:12px">
          <h3 style="margin:0 0 8px">${p.icon} ${escapeHtml(p.label)}</h3>
          <label>创作 / 发布入口 URL</label>
          <input type="url" name="social_entry_${escapeHtml(p.key)}" value="${escapeHtml(value)}" placeholder="https://..." />
          <p style="margin:6px 0 0;color:var(--muted);font-size:12px">${escapeHtml(p.helpText)}</p>
          ${value ? '<p style="margin:8px 0 0"><a class="btn secondary" href="' + escapeHtml(value) + '" target="_blank" rel="noopener noreferrer">打开入口 ↗</a></p>' : '<p style="margin:8px 0 0;color:var(--muted);font-size:12px">尚未设置入口地址。</p>'}
        </div>`
      }).join('')}
      <button class="btn" type="submit">保存平台入口</button>
    </form>
  `,
  })
}

export function renderSocialDistributionPage(rows: any[], platforms: PlatformConfig[], siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const statusLabel: Record<string, string> = { not_synced: '未生成', ready: '待人工发布', copied: '已复制', scheduled: '已排期' }
  return renderAdminLayout({
    title: '国内内容分发', active: '/admin/social', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title"><h2>📣 国内内容分发</h2><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn secondary" href="/admin/social/settings">⚙️ 平台入口设置</a><a href="/admin/articles">内容管理 →</a></div></div>
    <p class="admin-help">官网文章发布后生成各平台发布包。这里可以查看状态、直接进入对应平台编辑，并配置每个平台的官方创作/发布入口。</p>
    <div class="grid grid-4" style="margin-bottom:16px">
      ${platforms.map((p) => '<div class="card"><strong>' + p.icon + ' ' + escapeHtml(p.label) + '</strong><p style="font-size:12px;color:var(--muted);margin:6px 0">' + escapeHtml(p.helpText) + '</p><span class="badge">' + escapeHtml(p.copyMode === 'richtext' ? '富文本复制' : '纯文本复制') + '</span></div>').join('')}
    </div>
    <div class="card">
      <h3 style="margin-top:0">已发布文章的发布包</h3>
      <div class="admin-table-wrap">
        <table>
          <thead><tr><th>文章</th><th>发布时间</th><th>抖音</th><th>快手</th><th>小红书</th><th>哔哩哔哩</th><th>操作</th></tr></thead>
          <tbody>
          ${rows.length ? rows.map((row) => {
            const cell = (key: string) => {
              const val = row[key]
              let status = statusLabel.not_synced
              if (val && typeof val === 'string' && val in statusLabel) {
                const label = statusLabel[val as keyof typeof statusLabel]
                if (label) status = label
              }
              return '<span class="badge">' + escapeHtml(status) + '</span>'
            }
            return '<tr><td><strong>' + escapeHtml(row.title || '') + '</strong></td><td>' + escapeHtml(row.published_at || '') + '</td><td><a href="/admin/articles/' + encodeURIComponent(String(row.id)) + '/social/douyin">' + cell('douyin_status') + '</a></td><td><a href="/admin/articles/' + encodeURIComponent(String(row.id)) + '/social/kuaishou">' + cell('kuaishou_status') + '</a></td><td><a href="/admin/articles/' + encodeURIComponent(String(row.id)) + '/social/xiaohongshu">' + cell('xiaohongshu_status') + '</a></td><td><a href="/admin/articles/' + encodeURIComponent(String(row.id)) + '/social/bilibili">' + cell('bilibili_status') + '</a></td><td><a class="btn secondary" href="/admin/articles/' + encodeURIComponent(String(row.id)) + '/social">总览</a></td></tr>'
          }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:28px">暂无已发布文章</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    `
  })
}

export function renderSocialEditor(article: any, config: PlatformConfig, post: any, copyPayload: string, siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const status = post?.status || 'not_synced'
  const hashtags = post?.hashtags || ''
  const isRich = config.copyMode === 'richtext'
  return renderAdminLayout({
    title: `${config.label}分发`, active: '/admin/articles', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <h2>${config.icon} ${config.label} · ${escapeHtml(article.title)}</h2>
      <a href="/admin/articles/${article.id}/social" style="color:var(--muted);font-size:13px">← 返回多平台分发</a>
    </div>
    <p style="color:var(--muted);font-size:13px;margin-bottom:16px">
      状态：<span class="badge">${STATUS_LABEL[status]}</span>　${escapeHtml(config.helpText)}
    </p>

    <form method="post" action="/admin/articles/${article.id}/social/${config.key}/generate" style="margin-bottom:16px">
      <button class="btn secondary" type="submit">${post ? '🔄 用AI重新生成' : '✨ 用AI生成文案'}</button>
    </form>

    ${post ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
      <div>
        <form class="admin-form" method="post" action="/admin/articles/${article.id}/social/${config.key}">
          <label>标题</label>
          <input name="title" value="${escapeHtml(post.title || '')}" />
          <label>正文</label>
          <textarea name="content" rows="10">${escapeHtml(post.content || '')}</textarea>
          <label>话题标签（逗号分隔，不用带#号）</label>
          <input name="hashtags" value="${escapeHtml(hashtags)}" />
          <label>预约发布时间（仅自己提醒，不会自动发布）</label>
          <input type="datetime-local" name="scheduled_at" value="${escapeHtml((post.scheduled_at || '').slice(0, 16))}" />
          <button class="btn" type="submit">保存</button>
        </form>
      </div>
      <div>
        <h3 style="margin-top:0">预览（复制后粘贴到${config.label}${isRich ? '编辑器' : '发布框'}）</h3>
        <div id="socialPreview" class="card" style="max-height:460px;overflow:auto;white-space:${isRich ? 'normal' : 'pre-wrap'}">${sanitizeAdminPreviewHtml(copyPayload)}</div>
        <button class="btn" style="margin-top:12px;background:${config.color}" onclick="copySocialContent()">✅ 一键复制</button>
      </div>
    </div>
    <script>
    function copySocialContent(){
      const el = document.getElementById('socialPreview');
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try {
        document.execCommand('copy');
        fetch(window.location.pathname + '/mark-copied', { method: 'POST' }).catch(function(){});
        alert('已复制！打开${config.label} App/创作后台粘贴即可。');
      } catch (e) {
        alert('复制失败，请手动选中预览区域内容后按 Ctrl+C');
      }
      sel.removeAllRanges();
    }
    </script>
    ` : `<p style="color:var(--muted)">还没有生成过内容，点上面的按钮用 AI 生成一份草稿。</p>`}
  `,
  })
}
