import { renderAdminLayout } from './admin'
import { escapeHtml } from './layout'
import type { FormSchemaRow } from '../plugins/forms/service'
import { parseFields } from '../plugins/forms/service'

export function renderFormAdminPage(forms: FormSchemaRow[], submissions: any[], siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const formRows = forms
    .map((f) => `<tr>
      <td>${f.id}</td>
      <td>${escapeHtml(f.slug)}</td>
      <td>${escapeHtml(f.title)}</td>
      <td>${f.enabled ? '启用' : '停用'}</td>
      <td>
        <a href="/forms/${escapeHtml(f.slug)}" target="_blank">预览</a>
        &nbsp; <a href="/admin/forms/${escapeHtml(f.slug)}/export.csv">导出 CSV</a>
      </td>
    </tr>`).join('\n')

  const subRows = submissions
    .slice(0, 30)
    .map((s) => `<tr>
      <td>${s.id}</td>
      <td>${escapeHtml(s.slug || '?')}</td>
      <td style="font-size:12px;word-break:break-all">${escapeHtml(String(s.payload || '').slice(0, 300))}</td>
      <td>${escapeHtml(s.created_at || '')}</td>
    </tr>`).join('\n')

  return renderAdminLayout({
    title: '表单管理', active: '/admin/forms', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title"><h2>表单管理</h2><a href="/admin" style="color:var(--muted);font-size:13px">← 返回后台</a></div>
    <p style="color:var(--muted);font-size:13px">新建/编辑表单:slug 用于公开端点 <code>/forms/&lt;slug&gt;</code>；form_fields 为 JSON 数组字段定义。</p>
    <form class="admin-form" method="post" action="/admin/forms/save" style="max-width:640px">
      <label>表单 slug(英文)</label><input name="form_slug" required pattern="[a-z0-9-]+" placeholder="e.g. quote-request"/>
      <label>表单标题</label><input name="form_title" required/>
      <label>字段定义(JSON)</label>
      <textarea name="form_fields" rows="6" placeholder='[{"name":"name","label":"姓名","type":"text","required":true},{"name":"phone","label":"电话","type":"text"},{"name":"service","label":"需求","type":"select","options":["选项A","选项B"]}]'></textarea>
      <label><input type="checkbox" name="form_enabled" value="1" checked/> 启用</label>
      <button class="btn" type="submit">保存表单</button>
    </form>
    <h3>表单列表</h3>
    <table class="admin-table"><thead><tr><th>ID</th><th>slug</th><th>标题</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>${formRows || '<tr><td colspan="5">暂无表单</td></tr>'}</tbody></table>
    <h3>最近提交(前 30 条)</h3>
    <table class="admin-table"><thead><tr><th>ID</th><th>表单</th><th>内容</th><th>时间</th></tr></thead>
    <tbody>${subRows || '<tr><td colspan="4">暂无提交</td></tr>'}</tbody></table>`,
  })
}

export function renderFormPage(form: FormSchemaRow, fields: ReturnType<typeof parseFields>, siteName?: string, cspNonce?: string): string {
  const inputs = fields
    .map((f) => {
      const name = escapeHtml(f.name)
      const label = escapeHtml(f.label)
      const req = f.required ? ' required' : ''
      if (f.type === 'select') {
        return `<label>${label}${f.required ? ' *' : ''}
          <select name="${name}"${req}>
            <option value="">请选择</option>
            ${(f.options || []).map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}
          </select></label>`
      }
      if (f.type === 'radio') {
        return `<label>${label}${f.required ? ' *' : ''}
          <div>${(f.options || []).map((o) => `<label style="display:block;margin:4px 0"><input type="radio" name="${name}" value="${escapeHtml(o)}"/> ${escapeHtml(o)}</label>`).join('')}</div></label>`
      }
      if (f.type === 'textarea') {
        return `<label>${label}${f.required ? ' *' : ''}<textarea name="${name}" rows="4"${req}></textarea></label>`
      }
      if (f.type === 'email') {
        return `<label>${label}${f.required ? ' *' : ''}<input type="email" name="${name}"${req}/></label>`
      }
      if (f.type === 'number') {
        return `<label>${label}${f.required ? ' *' : ''}<input type="number" name="${name}"${req}/></label>`
      }
      return `<label>${label}${f.required ? ' *' : ''}<input type="text" name="${name}"${req}/></label>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(form.title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px}label{display:block;margin-bottom:14px;font-size:14px}input,textarea,select{width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:6px;margin-top:4px}button{padding:10px 24px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer}</style>
</head>
<body>
<h1>${escapeHtml(form.title)}</h1>
<form method="post" action="/forms/${escapeHtml(form.slug)}" id="form-sub">
  <input type="text" name="hp" style="display:none" autocomplete="off"/>
  ${inputs}
  <button type="submit">提交</button>
</form>
<script>
document.getElementById('form-sub').addEventListener('submit', async function(e) {
  e.preventDefault()
  const data = new FormData(this)
  const res = await fetch('/forms/${escapeHtml(form.slug)}', { method: 'POST', body: data })
  const json = await res.json().catch(() => ({}))
  if (json.ok) { this.innerHTML = '<h2>提交成功</h2><p>感谢您的留言，我们会尽快回复。</p>' }
  else { alert(json.error || '提交失败，请稍后重试') }
})
</script>
</body></html>`
}
