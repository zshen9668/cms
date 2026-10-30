import { renderAdminLayout } from './admin'
import { caseDisplayTitle, parseCaseResults, casePublicPath, CASE_RESULT_MAX_LINES, type CaseRecord } from '../utils/cases'
import { escapeHtml } from '../utils/html'

/**
 * 成功案例后台模板。
 *
 * 与城市模块的区别：案例的内容直接存在 cases 表，没有「AI 内容存储」和「图片存储」两层间接。
 * 一个表单管完所有字段，保存即生效，列表页一眼能看出哪些缺内容、哪些没设 SEO。
 */

function field(label: string, name: string, value: string, opts: { placeholder?: string; maxlength?: number; required?: boolean; hint?: string } = {}): string {
  const attrs = [
    `name="${escapeHtml(name)}"`,
    opts.maxlength ? `maxlength="${opts.maxlength}"` : '',
    opts.required ? 'required' : '',
    opts.placeholder ? `placeholder="${escapeHtml(opts.placeholder)}"` : '',
  ].filter(Boolean).join(' ')
  return `<label>${escapeHtml(label)}</label>
      <input ${attrs} value="${escapeHtml(value)}" />
      ${opts.hint ? `<p class="case-field-hint">${escapeHtml(opts.hint)}</p>` : ''}`
}

function textarea(label: string, name: string, value: string, rows: number, opts: { placeholder?: string; maxlength?: number; hint?: string } = {}): string {
  const attrs = [
    `name="${escapeHtml(name)}"`,
    `rows="${rows}"`,
    opts.maxlength ? `maxlength="${opts.maxlength}"` : '',
    opts.placeholder ? `placeholder="${escapeHtml(opts.placeholder)}"` : '',
  ].filter(Boolean).join(' ')
  return `<label>${escapeHtml(label)}</label>
      <textarea ${attrs}>${escapeHtml(value)}</textarea>
      ${opts.hint ? `<p class="case-field-hint">${escapeHtml(opts.hint)}</p>` : ''}`
}

export function renderCasesList(
  rows: CaseRecord[],
  opts: { message?: string; error?: string; saved?: boolean; page?: { mode: string; externalUrl: string; titleZh: string; subtitleZh: string; showForm: boolean } } = {},
  siteName?: string, cspNonce?: string, csrfToken?: string,
): string {
  const featuredCount = rows.filter((row) => Number(row.is_featured || 0) === 1).length
  const missingContent = rows.filter((row) => !String(row.content || '').trim()).length
  const missingSeo = rows.filter((row) => !String(row.seo_title || '').trim()).length

  const tableRows = rows.map((row) => {
    const steps = parseCaseResults(row.results).length
    return `<tr>
      <td><strong>${escapeHtml(caseDisplayTitle(row))}</strong><div class="case-slug">${escapeHtml(casePublicPath(row.slug))}</div></td>
      <td>${escapeHtml(row.industry || '')}</td>
      <td>${escapeHtml(row.service_name || '')}</td>
      <td>${escapeHtml(row.region || '')}</td>
      <td>${steps ? steps + ' 条' : '—'}</td>
      <td>${Number(row.is_featured || 0) === 1 ? '<span class="badge">精选</span>' : ''}</td>
      <td>${String(row.content || '').trim() ? '有正文' : '<span style="color:var(--muted)">仅摘要</span>'}</td>
      <td>${String(row.seo_title || '').trim() ? '已设置' : '<span style="color:var(--muted)">自动生成</span>'}</td>
      <td>${Number(row.is_active || 0) === 1 ? '展示中' : '已停用'}</td>
      <td class="city-row-actions">
        <a href="/admin/cases/${escapeHtml(String(row.id))}/edit">编辑</a>
        <a href="${escapeHtml(casePublicPath(row.slug))}" target="_blank" rel="noopener">预览</a>
        <form method="post" action="/admin/cases/${escapeHtml(String(row.id))}/delete" style="display:inline" onsubmit="return confirm('确认删除该案例？删除后前台立即不可访问，且不可恢复。')">
          <button class="btn secondary" type="submit" style="color:#e5484d">删除</button>
        </form>
      </td>
    </tr>`
  }).join('')

  return renderAdminLayout({
    title: '成功案例', active: '/admin/cases', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title"><h2>成功案例</h2><a class="btn" href="/admin/cases/new">＋ 新增案例</a></div>
    <div class="card" style="margin-bottom:16px;background:#f8fbff;border-color:#dbe7f7">
      <strong>案例和城市页面的分工</strong>
      <p style="color:var(--muted);font-size:12px;line-height:1.8;margin:6px 0 0">
        案例（这里）= 展示交付能力：谁、遇到什么问题、怎么解决、结果如何。前台地址是 <code>/case</code>，并占据首页一个模块位。<br />
        城市（<a href="/admin/cities">城市管理</a>）= 本地搜索落地页：地址是 <code>/city/...</code>，用于「城市 × 服务」关键词收录。两者互不影响，可以同时存在。
      </p>
    </div>
    ${opts.error ? `<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px">${escapeHtml(opts.error)}</div>` : ''}
    ${opts.message ? `<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">${escapeHtml(opts.message)}</div>` : ''}
    ${opts.saved ? '<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">案例页设置已保存，前台立即生效。</div>' : ''}
    ${(() => {
      const page = opts.page
      if (!page) return ''
      const modeLabel = page.mode === 'external' ? '外站链接' : page.mode === 'hidden' ? '隐藏' : '本站内容'
      return `<div class="card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <strong>📄 案例页设置（前台 <code>/case</code>）</strong>
          <p style="color:var(--muted);font-size:12px;line-height:1.8;margin:6px 0 0">
            这里控制案例<strong>列表页本身</strong>：页面标题、副标题、是否显示留言表单，以及隐藏或跳转外站。
            当前模式：<span class="badge">${escapeHtml(modeLabel)}</span>
          </p>
        </div>
        <a class="btn secondary" href="/case" target="_blank" rel="noopener">打开前台 →</a>
      </div>
      <form class="admin-form" method="post" action="/admin/cases/page-settings" style="margin-top:12px">
        <div class="grid grid-2">
          <div>
            <label>页面标题（留空用系统默认「成功案例」）</label>
            <input name="title_zh" maxlength="200" value="${escapeHtml(page.titleZh)}" placeholder="例如：客户交付实录" />
            <label>页面副标题</label>
            <textarea name="subtitle_zh" rows="2" maxlength="500" placeholder="留空用系统默认说明">${escapeHtml(page.subtitleZh)}</textarea>
          </div>
          <div>
            <label>页面模式</label>
            <select name="mode">
              <option value="internal" ${page.mode === 'internal' ? 'selected' : ''}>本站页面（展示下方案例列表）</option>
              <option value="external" ${page.mode === 'external' ? 'selected' : ''}>外站链接（直接跳转）</option>
              <option value="hidden" ${page.mode === 'hidden' ? 'selected' : ''}>隐藏页面（前台 404）</option>
            </select>
            <label>外站链接（仅外站链接模式生效）</label>
            <input name="external_url" maxlength="500" value="${escapeHtml(page.externalUrl)}" placeholder="https://example.com/cases" />
            <label style="display:flex;align-items:center;gap:8px;margin-top:10px"><input type="checkbox" name="show_form" ${page.showForm !== false ? 'checked' : ''} /> 前台显示留言表单</label>
          </div>
        </div>
        <div class="admin-actions" style="margin-top:12px">
          <button class="btn" type="submit">保存案例页设置</button>
          <a class="btn secondary" href="/admin/pages/cases/edit">高级设置（SEO 正文 / 英文内容）→</a>
        </div>
      </form>
    </div>`
    })()}
    <div class="card" style="margin-bottom:16px;display:flex;gap:16px;flex-wrap:wrap;font-size:13px">
      <span>案例总数：<strong>${rows.length}</strong></span>
      <span>首页精选：<strong>${featuredCount}</strong></span>
      <span>缺少正文：<strong>${missingContent}</strong></span>
      <span>未设 SEO 标题：<strong>${missingSeo}</strong></span>
    </div>
    ${rows.length ? `<div class="admin-table-wrap"><table>
      <thead><tr>
        <th>案例</th><th>行业</th><th>服务</th><th>地区</th><th>成果</th><th>精选</th><th>正文</th><th>SEO</th><th>状态</th><th>操作</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>` : `<div class="card"><p style="margin:0;color:var(--muted)">还没有案例。点右上角「＋ 新增案例」录入第一个成功案例。首页在你添加并启用案例后会自动出现「成功案例」模块。</p></div>`}
  `,
  })
}

export function renderCaseForm(
  row: CaseRecord | null,
  opts: { error?: string; aiError?: string; aiNotice?: string; suggestedSlug?: string; aiContent?: string; aiSummary?: string } = {},
  siteName?: string, cspNonce?: string, csrfToken?: string,
): string {
  const isNew = !row
  const value = (key: keyof CaseRecord): string => {
    const raw = row ? row[key] : ''
    if (raw === null || raw === undefined) {
      if (isNew && key === 'content' && opts.aiContent) return opts.aiContent
      if (isNew && key === 'summary' && opts.aiSummary) return opts.aiSummary
      return ''
    }
    return String(raw)
  }
  const checked = (key: keyof CaseRecord): string => (row ? (Number(row[key]) === 1 ? 'checked' : '') : '')
  const action = isNew ? '/admin/cases/new' : '/admin/cases/' + String(row?.id) + '/edit'

  return renderAdminLayout({
    title: isNew ? '新增成功案例' : '编辑成功案例',
    active: '/admin/cases', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <h2>${isNew ? '新增成功案例' : '编辑成功案例'}</h2>
      <a class="btn secondary" href="/admin/cases">← 返回案例列表</a>
    </div>
    ${opts.error ? `<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px">${escapeHtml(opts.error)}</div>` : ''}
    ${opts.aiError ? `<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px">${escapeHtml(opts.aiError)}</div>` : ''}
    ${opts.aiNotice ? `<div class="card" style="border-left:4px solid #2563eb;color:#2563eb;margin-bottom:16px">${escapeHtml(opts.aiNotice)}</div>` : ''}

    <form class="admin-form" method="post" action="${escapeHtml(action)}">
      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">基本信息</h3>
        ${field('客户名称', 'client_name', value('client_name'), { maxlength: 120, required: true, placeholder: '例如：深圳某连锁餐饮企业', hint: '不便公开全称时可以脱敏，例如「某连锁餐饮企业」。这一项会作为案例标题。' })}
        ${field('案例网址标识 slug', 'slug', value('slug') || (isNew ? (opts.suggestedSlug || '') : ''), { maxlength: 60, required: true, placeholder: '例如 shenzhen-catering-seo', hint: '只允许小写英文、数字和短横线。中文客户名无法自动转换，请手动填写；前台地址为 /case/这个值。' })}
        ${field('所属行业', 'industry', value('industry'), { maxlength: 60, placeholder: '例如 连锁餐饮' })}
        ${field('采用的服务', 'service_name', value('service_name'), { maxlength: 80, placeholder: '例如 企业官网建设', hint: '填服务管理里的服务名称即可，用于关联与关键词生成。' })}
        ${field('服务地区', 'region', value('region'), { maxlength: 60, placeholder: '例如 深圳' })}
        ${field('排序', 'sort_order', value('sort_order') || '0', { maxlength: 6, hint: '数字越小越靠前。' })}
        <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="is_featured" value="1" ${checked('is_featured')} /> 设为首页精选（首页「成功案例」模块优先展示精选案例）</label>
        <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="is_active" value="1" ${isNew ? 'checked' : checked('is_active')} /> 前台展示（取消勾选即从列表和首页隐藏）</label>
      </div>

      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">案例内容</h3>
        ${textarea('一句话摘要', 'summary', value('summary'), 2, { maxlength: 300, placeholder: '例如：为一家 60 家门店的连锁餐饮企业重建官网，三个月内自然搜索流量翻倍。', hint: '显示在列表卡片上，也是搜索摘要的兜底内容。' })}
        ${textarea('项目挑战', 'challenge', value('challenge'), 3, { maxlength: 2000, placeholder: '客户当时遇到的问题、限制条件、已有做法的不足。一行一段。' })}
        ${textarea('解决方案', 'solution', value('solution'), 4, { maxlength: 3000, placeholder: '你们做了什么、为什么这么做、分几个阶段。一行一段。' })}
        ${textarea('成果数据', 'results', value('results'), 5, { maxlength: 1500, placeholder: '每行一条，例如：上线 3 个月自然搜索收录 120 页', hint: `一行一条，最多 ${CASE_RESULT_MAX_LINES} 条。这是最能说服访客的部分，也会显示在列表卡片的第一条。` })}
        ${textarea('客户评价', 'testimonial', value('testimonial'), 2, { maxlength: 600, placeholder: '客户的原话。留空则不显示评价区块。' })}
        ${textarea('案例正文（可选）', 'content', value('content'), 8, { maxlength: 16000, placeholder: '补充叙述。支持简单 HTML（p / h2 / h3 / ul / ol / li / strong / em）。', hint: isNew ? '也可以先保存案例，再用「AI 生成正文」由已有字段扩写。' : '可以用下方「AI 生成正文」按钮，基于上面的挑战/方案/成果自动扩写。' })}
      </div>

      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">展示素材</h3>
        ${field('封面图地址', 'cover_image_url', value('cover_image_url'), { maxlength: 500, placeholder: '/media/... 或 https://...', hint: '可先在「媒体库」上传图片，再把地址复制到这里。留空则卡片不显示图片。' })}
        ${field('交付成果链接（可选）', 'project_url', value('project_url'), { maxlength: 500, placeholder: 'https://客户交付的站点地址', hint: '会以外部链接形式显示在案例详情页，并带上 nofollow。' })}
      </div>

      <div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">SEO</h3>
        <p style="color:var(--muted);font-size:12px;line-height:1.8;margin:0 0 12px">全部留空时系统会按客户名、行业、服务和地区自动生成。也可以点下面的「自动 SEO」按钮先填好再手动微调。</p>
        ${field('SEO 标题', 'seo_title', value('seo_title'), { maxlength: 120, placeholder: '留空自动生成' })}
        ${textarea('SEO 描述', 'seo_description', value('seo_description'), 2, { maxlength: 300, placeholder: '留空自动生成' })}
        ${field('SEO 关键词', 'seo_keywords', value('seo_keywords'), { maxlength: 300, placeholder: '留空自动生成' })}
      </div>

      <div class="admin-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" type="submit">保存案例</button>
        ${isNew
          ? `<button class="btn secondary" type="submit" formaction="/admin/cases/ai-content">🤖 AI 生成正文</button>`
          : `<button class="btn secondary" type="submit" formaction="/admin/cases/${escapeHtml(String(row?.id))}/auto-seo">自动 SEO</button>
        <button class="btn secondary" type="submit" formaction="/admin/cases/${escapeHtml(String(row?.id))}/ai-content">🤖 AI 生成正文</button>`}
      </div>
      ${isNew ? '<p style="color:var(--muted);font-size:12px;margin-top:10px">填写客户名称、项目挑战、解决方案或成果后，可点「AI 生成正文」由 AI 自动扩写案例正文。</p>' : ''}
    </form>

    <script>
    (function () {
      var nameInput = document.querySelector('input[name="client_name"]');
      var slugInput = document.querySelector('input[name="slug"]');
      if (!nameInput || !slugInput) return;
      var touched = ${isNew ? 'false' : 'true'};
      slugInput.addEventListener('input', function () { touched = true; });
      nameInput.addEventListener('input', function () {
        if (touched) return;
        var v = String(nameInput.value || '').toLowerCase().trim()
          .replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
        if (v.length >= 2) slugInput.value = v.slice(0, 60);
      });
    })();
    </script>
  `,
  })
}
