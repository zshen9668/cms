/** 后台多租户管理：租户列表与新建。只读展示，暂不做增删改。 */
import { escapeHtml } from './layout'
import { renderAdminLayout } from './adminLayout'

export function renderTenantsList(
  rows: Array<{ id: number; slug: string; display_name: string; owner_email: string; tier: string; status: string; created_at: string }>,
  siteName?: string, cspNonce?: string, csrfToken?: string,
): string {
  return renderAdminLayout({
    title: '租户管理', active: '/admin/tenants', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title"><h2>多租户管理</h2><a class="btn" href="/admin/tenants/new">＋ 新建租户</a></div>
    <div class="admin-table-wrap">
    <table>
      <thead><tr><th>租户名称</th><th>Slug</th><th>所有者邮箱</th><th>套餐</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
      <tbody>
      ${rows.map((r) => `<tr>
        <td><strong>${escapeHtml(r.display_name || r.slug)}</strong></td>
        <td><code>${escapeHtml(r.slug)}</code></td>
        <td>${escapeHtml(r.owner_email)}</td>
        <td>${escapeHtml(r.tier)}</td>
        <td><span class="badge">${r.status === 'active' ? '启用' : r.status}</span></td>
        <td style="font-size:12px;color:var(--muted)">${escapeHtml(r.created_at || '')}</td>
        <td><a href="/admin/tenants/${escapeHtml(String(r.slug))}/edit">编辑</a></td>
      </tr>`).join('')}
      </tbody>
    </table>
    ${rows.length === 0 ? '<p style="color:var(--muted)">暂无租户。</p>' : ''}
    </div>
    `,
  })
}

export function renderTenantForm(
  tenant: { id?: number; slug: string; display_name: string; owner_email: string; tier: string; status: string },
  opts: { message?: string; error?: string; isNew: boolean } = { isNew: true },
  siteName?: string, cspNonce?: string, csrfToken?: string,
): string {
  return renderAdminLayout({
    title: opts.isNew ? '新建租户' : '编辑租户', active: '/admin/tenants', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title"><h2>${opts.isNew ? '新建租户' : '编辑租户'}</h2><a class="btn secondary" href="/admin/tenants">← 返回列表</a></div>
    ${opts.error ? `<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px">${escapeHtml(opts.error)}</div>` : ''}
    ${opts.message ? `<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">${escapeHtml(opts.message)}</div>` : ''}
    <form class="admin-form" method="post" action="${opts.isNew ? '/admin/tenants' : '/admin/tenants/' + escapeHtml(String(tenant.id))}">
      <label>租户名称</label>
      <input name="display_name" value="${escapeHtml(tenant.display_name)}" placeholder="例如：内蒙古算力中心" required />
      <label>Slug（唯一标识，用于子域名或路径前缀）</label>
      <input name="slug" value="${escapeHtml(tenant.slug)}" placeholder="例如：imdc" pattern="[a-z0-9-]+" required />
      <label>所有者邮箱</label>
      <input name="owner_email" type="email" value="${escapeHtml(tenant.owner_email)}" required />
      <label>套餐</label>
      <select name="tier">
        <option value="free" ${tenant.tier === 'free' ? 'selected' : ''}>免费</option>
        <option value="basic" ${tenant.tier === 'basic' ? 'selected' : ''}>基础</option>
        <option value="pro" ${tenant.tier === 'pro' ? 'selected' : ''}>专业</option>
        <option value="enterprise" ${tenant.tier === 'enterprise' ? 'selected' : ''}>企业</option>
      </select>
      <label>状态</label>
      <select name="status">
        <option value="active" ${tenant.status === 'active' ? 'selected' : ''}>启用</option>
        <option value="inactive" ${tenant.status === 'inactive' ? 'selected' : ''}>停用</option>
      </select>
      <button class="btn" type="submit">${opts.isNew ? '新建租户' : '保存租户'}</button>
    </form>
    `,
  })
}
