import { renderAdminLayout } from './admin'
import { escapeHtml } from './layout'
import type { ApiKeyRow } from '../plugins/apiKeys/service'

export type ApiKeyListItem = Omit<ApiKeyRow, 'key_hash'>

export function renderApiKeyPage(keys: ApiKeyListItem[], siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const rows = keys
    .map((k) => {
      const name = String(k.name ?? '')
      const prefix = String(k.key_prefix ?? '')
      const scopes = String(k.scopes ?? '')
      const lastUsed = String(k.last_used_at ?? '') || '从未使用'
      const expiresAtRaw = k.expires_at != null && String(k.expires_at).trim() !== '' ? String(k.expires_at) : ''
      const expired = !!expiresAtRaw && Date.parse(expiresAtRaw) < Date.now()
      const expiry = expiresAtRaw ? expiresAtRaw + (expired ? '（已过期）' : '') : '永久有效'
      return `<tr${expired ? ' style="opacity:0.55"' : ''}>
        <td>${escapeHtml(name)}</td>
        <td><code>${escapeHtml(prefix)}…</code></td>
        <td>${escapeHtml(scopes)}</td>
        <td>${escapeHtml(lastUsed)}</td>
        <td>${escapeHtml(expiry)}</td>
        <td>
          <form method="post" action="/admin/api-keys/${k.id}/revoke"
            onsubmit="return confirm('吊销该密钥?吊销后使用该密钥的 API 调用将立即失败。')">
            <button class="btn btn-sm btn-danger" type="submit">吊销</button>
          </form>
        </td>
      </tr>`
    })
    .join('\n')

  return renderAdminLayout({
    title: 'API 密钥管理',
    active: '/admin/settings',
    siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <h2>API 密钥</h2>
      <span style="color:var(--muted);font-size:13px">Bearer 认证,供公开 API 只读调用(见公开 /api/v2 读端点)</span>
    </div>

    <div class="card" style="max-width:520px">
      <h3 style="margin-top:0">新建密钥</h3>
      <form class="admin-form" method="post" action="/admin/api-keys/create">
        <label>名称(用途备注,如「OpenAPI 只读」)</label>
        <input name="name" maxlength="80" required />
        <label>权限范围</label>
        <div class="admin-form-hint" style="margin-bottom:12px">
          <label style="display:block;margin:4px 0">
            <input type="checkbox" name="scopes" value="read" checked disabled /> 只读(read)
          </label>
          <small style="color:var(--muted)">当前仅开放 read;write 权限将在后续版本随 RBAC 提供</small>
        </div>
        <label>过期时间(可留空=永久)</label>
        <input type="datetime-local" name="expires_at" />
        <button class="btn" type="submit">创建密钥</button>
      </form>
    </div>

    <div class="card" style="margin-top:16px">
      <h3 style="margin-top:0">现有密钥</h3>
      <table class="admin-table">
        <thead>
          <tr><th>名称</th><th>前缀</th><th>范围</th><th>最近使用</th><th>过期</th><th>操作</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="6">暂无密钥</td></tr>'}</tbody>
      </table>
    </div>`,
  })
}

/** 创建成功页:完整密钥只显示这一次 */
export function renderApiKeyCreatedPage(fullKey: string, key: ApiKeyListItem, siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const name = String(key.name ?? '')
  const prefix = String(key.key_prefix ?? '')
  const scopes = String(key.scopes ?? '')
  return renderAdminLayout({
    title: '密钥已创建',
    active: '/admin/settings',
    siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <h2>密钥已创建</h2>
      <a href="/admin/api-keys" style="color:var(--muted);font-size:13px">← 返回 API 密钥管理</a>
    </div>
    <div class="card" style="max-width:640px;border:2px solid var(--danger,#c0392b)">
      <p style="font-weight:600;color:var(--danger,#c0392b);margin-top:0">
        ⚠ 此密钥只显示一次,请立即保存
      </p>
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px">
        密钥名称:${escapeHtml(name)} · 前缀 <code>${escapeHtml(prefix)}…</code> ·
        范围:${escapeHtml(scopes)}
      </p>
      <textarea rows="3" readonly style="width:100%;font-family:ui-monospace,monospace;font-size:14px">${escapeHtml(fullKey)}</textarea>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-sm" type="button"
          onclick="navigator.clipboard.writeText(this.closest('div').querySelector('textarea').value).then(()=>alert('已复制到剪贴板'))">复制</button>
        <a class="btn btn-sm" href="/admin/api-keys">我已保存</a>
      </div>
      <p style="font-size:12px;color:var(--muted)">
        使用方式:请求头 <code>Authorization: Bearer ${escapeHtml(prefix)}…</code>
      </p>
    </div>`,
  })
}
