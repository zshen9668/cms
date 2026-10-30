import { renderAdminLayout } from './adminLayout'
import { escapeHtml } from './layout'
import { RBAC_MODULES, RBAC_MODULE_LABELS, type RoleRow, type RbacModule } from '../plugins/rbac/service'

/**
 * RBAC 角色权限面板。
 *
 * 设计要点：
 * - 分配角色用「管理员下拉框」而不是让站长手填管理员 id —— 旧面板要求输入数字 id，
 *   站长根本不知道自己的 id 是多少，等于不可用。
 * - 账号可以直接在这里新建：系统原来只有一个管理员账号，自定义角色永远显示「未分配」，
 *   因为根本没有第二个账号可以分配。没有建账号入口，角色管理就是个摆设。
 * - 每个角色可以勾选「能进哪些后台模块」，勾选结果由 requireAdmin 之后的中间件强制执行。
 *   一个模块都不勾 = 该角色登录后只能看到「无权限」提示，不会静默放行。
 * - 内置 admin 角色不可删除、不可作为分配目标（它就是「全部权限」本身）。
 */
export function renderRolePanel(
  roles: RoleRow[],
  admins: Array<{ id: number; email: string; role: string; created_at?: string }> = [],
  flash: { ok?: string; error?: string } = {},
  permissions: Record<string, string[]> = {},
  currentAdminId = 0,
  siteName?: string, cspNonce?: string, csrfToken?: string,
): string {
  const BUILTIN = 'admin'
  const customRoles = roles.filter((r) => String(r.name) !== BUILTIN)
  const roleNames = customRoles.map((r) => String(r.name))
  const assignedCount = (name: string) => admins.filter((a) => a.role === name).length

  const adminRows = admins.map((admin) => {
    const isBuiltin = admin.role === BUILTIN
    const roleLabel = isBuiltin
      ? '<span class="badge">超级管理员（全部权限）</span>'
      : `<span class="badge">${escapeHtml(admin.role || '未设置')}</span>`
    const isSelf = Number(admin.id) === Number(currentAdminId)
    return `<tr>
      <td>${admin.id}</td>
      <td>${escapeHtml(admin.email)}${isSelf ? ' <small style="color:var(--muted)">（当前登录）</small>' : ''}</td>
      <td>${roleLabel}</td>
      <td>
        <form method="post" action="/admin/rbac/admins/${admin.id}/role" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <select name="role" style="min-width:150px">
            <option value="${BUILTIN}"${isBuiltin ? ' selected' : ''}>超级管理员（全部权限）</option>
            ${roleNames.map((name) => `<option value="${escapeHtml(name)}"${admin.role === name ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}
          </select>
          <button class="btn btn-sm" type="submit">保存角色</button>
        </form>
      </td>
      <td>
        ${isSelf ? '<span style="color:var(--muted);font-size:12px">不能删除自己</span>' : `<form method="post" action="/admin/rbac/admins/${admin.id}/delete" onsubmit="return confirm('确认删除账号 ${escapeHtml(admin.email)}？删除后该账号立即无法登录。')"><button class="btn btn-sm secondary" type="submit" style="color:#e5484d">删除账号</button></form>`}
      </td>
    </tr>`
  }).join('\n')

  const roleRows = customRoles.map((r) => {
    const id = Number(r.id)
    const name = String(r.name)
    const used = assignedCount(name)
    const configured = Object.prototype.hasOwnProperty.call(permissions, name)
    const allowed = permissions[name] || []
    const moduleBoxes = RBAC_MODULES.map((m) => `
      <label class="rbac-module"><input type="checkbox" name="modules" value="${m}"${allowed.includes(m) ? ' checked' : ''} /> <span>${escapeHtml(RBAC_MODULE_LABELS[m as RbacModule])}</span></label>`).join('')
    return `<tr>
      <td>${id}</td>
      <td><strong>${escapeHtml(name)}</strong></td>
      <td>${escapeHtml(String(r.created_at || ''))}</td>
      <td>${used ? `<span class="badge">${used} 个账号在用</span>` : '<span style="color:var(--muted)">未分配</span>'}</td>
      <td>
        <form method="post" action="/admin/rbac/roles/${id}/permissions" class="rbac-perm-form">
          <div class="rbac-modules">${moduleBoxes}</div>
          <div class="rbac-perm-actions">
            <button class="btn btn-sm" type="submit">保存权限</button>
            <span class="rbac-perm-state">${configured ? (allowed.length ? '已限制为 ' + allowed.length + ' 个模块' : '已限制为「不能进任何模块」') : '未配置：不限制（可进全部模块）'}</span>
          </div>
        </form>
      </td>
      <td>
        <form method="post" action="/admin/rbac/roles/${id}/delete" onsubmit="return confirm('删除角色「${escapeHtml(name)}」？仅当没有管理员在使用时才允许。')">
          <button class="btn btn-sm secondary" type="submit" style="color:#e5484d">删除</button>
        </form>
      </td>
    </tr>`
  }).join('\n')

  return renderAdminLayout({
    title: '角色权限',
    active: '/admin/rbac', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <div>
        <h2>🛡️ 角色权限</h2>
        <p style="margin:4px 0 0;color:var(--muted);font-size:13px">新建后台账号、分配角色，并限定每个角色能进哪些后台模块。</p>
      </div>
      <a href="/admin/settings" style="color:var(--muted);font-size:13px">← 返回系统设置</a>
    </div>

    ${flash.ok ? `<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">${escapeHtml(flash.ok)}</div>` : ''}
    ${flash.error ? `<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px">${escapeHtml(flash.error)}</div>` : ''}

    <div class="card rbac-intro">
      <h3 style="margin-top:0">这个功能能做什么</h3>
      <ul>
        <li><strong>新建后台账号</strong>：填邮箱 + 密码 + 角色，账号立刻可以登录后台。</li>
        <li><strong>创建自定义角色</strong>：例如「编辑」「运营」「只读」，角色名由你自己定。</li>
        <li><strong>限定角色能进哪些模块</strong>：勾选后，该角色的账号访问未勾选模块会被拦下并提示无权限。</li>
        <li><strong>收回权限</strong>：把账号改回「超级管理员」，或删除不再使用的角色。</li>
      </ul>
      <h3>怎么用（三步）</h3>
      <ol>
        <li>先在「创建新角色」里建一个角色，例如 <code>editor</code>。</li>
        <li>在「自定义角色」里勾选它可访问的后台模块，点「保存权限」。</li>
        <li>在「新建后台账号」里用这个角色建一个账号，交给同事使用。</li>
      </ol>
      <h3>边界说明（重要）</h3>
      <ul>
        <li><strong>「超级管理员」是内置角色</strong>，拥有全部权限，不受模块勾选限制，不可删除。</li>
        <li><strong>未配置权限的角色 = 不限制</strong>（可进全部模块），这是为了兼容升级前已存在的角色；要限制就至少勾一个模块。</li>
        <li><strong>删除角色前必须先收回</strong>：还有账号在用时不允许删除，避免账号挂着不存在的角色。</li>
        <li>角色与权限按租户隔离：<code>/t/&lt;slug&gt;</code> 下的角色不会和主站互相串。</li>
      </ul>
    </div>

    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">新建后台账号</h3>
      <form method="post" action="/admin/rbac/admins" class="admin-form" style="max-width:none">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
          <div><label>登录邮箱</label><input type="email" name="email" maxlength="200" required placeholder="colleague@example.com" /></div>
          <div><label>初始密码</label><input type="password" name="password" maxlength="128" required autocomplete="new-password" placeholder="至少 10 位，含两类字符" /></div>
          <div><label>角色</label>
            <select name="role">
              <option value="${BUILTIN}">超级管理员（全部权限）</option>
              ${roleNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <button class="btn" type="submit">创建账号</button>
      </form>
      <p style="color:var(--muted);font-size:12px;margin:8px 0 0">密码规则与「系统设置 → 管理员账号」一致：至少 10 位、包含两类字符、不能与邮箱相同。</p>
    </div>

    <div class="card" style="margin-bottom:20px">
      <h3 style="margin-top:0">管理员与角色</h3>
      <p style="color:var(--muted);font-size:12px;margin:0 0 12px">改完点该行的「保存角色」立即生效，账号无需重新登录。</p>
      <div class="admin-table-wrap"><table>
        <thead><tr><th>ID</th><th>登录邮箱</th><th>当前角色</th><th>修改角色</th><th>操作</th></tr></thead>
        <tbody>${adminRows || '<tr><td colspan="5" style="color:var(--muted)">暂无管理员账号</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">自定义角色与可访问模块</h3>
      <div class="admin-table-wrap"><table>
        <thead><tr><th>#</th><th>角色名</th><th>创建时间</th><th>使用情况</th><th>可访问模块</th><th>操作</th></tr></thead>
        <tbody>${roleRows || '<tr><td colspan="6" style="color:var(--muted)">暂无自定义角色。用上面的表单创建第一个。</td></tr>'}</tbody>
      </table></div>
    </div>

    <style>
      .rbac-intro ul,.rbac-intro ol{margin:8px 0 16px;padding-left:1.4em}
      .rbac-intro li{margin:5px 0;font-size:13px;line-height:1.8}
      .rbac-intro h3{font-size:14px;margin:16px 0 0}
      .rbac-intro h3:first-child{margin-top:0}
      .rbac-intro code{padding:1px 5px;border-radius:4px;background:#f1f5f9;font-size:12px}
      .rbac-perm-form{margin:0;min-width:260px}
      .rbac-modules{display:grid;gap:4px}
      .rbac-module{display:flex;align-items:flex-start;gap:6px;font-size:12px;line-height:1.6;color:var(--text)}
      .rbac-perm-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
      .rbac-perm-state{color:var(--muted);font-size:11px}
    </style>`,
  })
}
