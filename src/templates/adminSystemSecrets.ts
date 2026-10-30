import { renderAdminLayout } from './admin'
import type { SystemSecretSpec } from '../utils/systemSecrets'
import { escapeHtml } from '../utils/html'

/**
 * 「系统密钥」后台页面。
 *
 * 设计目标：站长不需要在 Cloudflare 里预先配置任何 Secret。
 * 所有运行时密钥都在这里填写，加密后存进 D1；未填写的功能自动降级跳过，不会报错。
 *
 * 页面按用途分组（安全与登录 / AI / 搜索引擎推送 / 企业微信），
 * 每组一个独立表单，改哪块存哪块。已配置的密钥只显示「已配置」，永不回显原文。
 */

export type SystemSecretField = SystemSecretSpec & { configured: boolean }

export type SystemSecretGroupView = {
  id: string
  label: string
  description: string
  items: SystemSecretField[]
}

function statusBadge(configured: boolean): string {
  return configured
    ? '<span class="badge" style="background:#e8f7ef;color:#1a8a4e;border-color:#b7e3cd">已配置</span>'
    : '<span class="badge" style="background:#f4f4f5;color:#7a7a83">未配置</span>'
}

function renderField(spec: SystemSecretField): string {
  const placeholder = spec.configured
    ? '已配置，留空表示不修改'
    : spec.placeholder
  const valueAttr = ''
  const input = spec.multiline
    ? `<textarea name="${escapeHtml(spec.name)}" rows="4" autocomplete="off" placeholder="${escapeHtml(placeholder)}"${valueAttr}></textarea>`
    : spec.masked
      ? `<input type="password" name="${escapeHtml(spec.name)}" autocomplete="new-password" placeholder="${escapeHtml(placeholder)}"${valueAttr} />`
      : `<input type="text" name="${escapeHtml(spec.name)}" autocomplete="off" placeholder="${escapeHtml(placeholder)}"${valueAttr} />`
  return `
    <div style="margin:0 0 14px">
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span>${escapeHtml(spec.label)}</span>
        ${statusBadge(spec.configured)}
      </label>
      ${input}
      <p style="margin:6px 0 0;color:var(--muted);font-size:12px;line-height:1.7">${escapeHtml(spec.hint)}</p>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);margin-top:6px">
        <input type="checkbox" name="clear_${escapeHtml(spec.name)}" value="on" />
        清除已保存的${escapeHtml(spec.label)}
      </label>
    </div>`
}

function renderGroup(group: SystemSecretGroupView): string {
  const hasSessionInvalidatingField = group.items.some((item) => item.invalidatesSessions)
  const confirmAttr = hasSessionInvalidatingField
    ? ` onclick="return confirm('修改登录会话签名密钥会让所有已登录的后台会话立即失效，需要重新登录。确认继续？')"`
    : ''
  return `
    <form class="admin-form card" method="post" action="/admin/system-secrets" style="margin:0 0 16px">
      <input type="hidden" name="group" value="${escapeHtml(group.id)}" />
      <h3 style="margin:0 0 6px">${escapeHtml(group.label)}</h3>
      <p style="margin:0 0 14px;color:var(--muted);font-size:12px;line-height:1.8">${escapeHtml(group.description)}</p>
      ${group.items.map(renderField).join('')}
      <button class="btn" type="submit"${confirmAttr}>保存「${escapeHtml(group.label)}」</button>
    </form>`
}

export function renderSystemSecretsPage(
  groups: SystemSecretGroupView[],
  opts: { saved?: string; cleared?: string; error?: string; siteName?: string, cspNonce?: string, csrfToken?: string } = {},
): string {
  const savedGroup = groups.find((group) => group.id === opts.saved)
  const clearedField = opts.cleared || ''
  const notices: string[] = []
  if (savedGroup) {
    notices.push(`<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">「${escapeHtml(savedGroup.label)}」已保存，立即生效。</div>`)
  }
  if (clearedField) {
    notices.push(`<div class="card" style="border-left:4px solid #1a8a4e;color:#1a8a4e;margin-bottom:16px">已清除 ${escapeHtml(clearedField)}。</div>`)
  }
  if (opts.error) {
    notices.push(`<div class="card" style="border-left:4px solid #e5484d;color:#e5484d;margin-bottom:16px">${escapeHtml(opts.error)}</div>`)
  }

  return renderAdminLayout({
    title: '系统密钥',
    active: '/admin/system-secrets', siteName: opts.siteName, cspNonce: opts.cspNonce, csrfToken: opts.csrfToken,
    body: `
    <div class="section-title"><h2>系统密钥</h2></div>
    <div class="card" style="margin:0 0 16px;background:#f8fbff;border-color:#dbe7f7">
      <h3 style="margin:0 0 6px">这里填完就能用，不需要先在 Cloudflare 配置</h3>
      <p style="margin:0;color:var(--muted);font-size:12px;line-height:1.9">
        全部密钥都加密保存在你自己的数据库里，保存后页面只显示「已配置」，永远不会回显原文，
        也不会写入 <code>wrangler.toml</code> 或提交到代码仓库。<br />
        没填的密钥不会让站点报错——对应功能会自动跳过。
        没填推送密钥，新文章靠搜索引擎自然发现。<br />
        如果你之前在 Cloudflare 里配过同名 Secret，这里留空也会继续沿用，不会打断已有部署。
      </p>
    </div>
    ${notices.join('')}
    ${groups.map(renderGroup).join('')}
  `,
  })
}
