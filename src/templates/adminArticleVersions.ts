import { renderAdminLayout } from './admin'
import { escapeHtml } from './layout'
import type { ArticleVersionRow } from '../plugins/versioning/service'

export function renderVersionPanel(articleId: number, versions: ArticleVersionRow[], siteName?: string, cspNonce?: string, csrfToken?: string): string {
  const rows = versions
    .map((v, i) => {
      const num = versions.length - i
      return `<tr>
        <td>${num}</td>
        <td>${escapeHtml(v.title)}</td>
        <td>${escapeHtml(v.status)}</td>
        <td>${escapeHtml(v.created_at || '')}</td>
        <td>
          <form method="post" action="/admin/articles/${articleId}/versions/${v.version_number}/restore" onsubmit="return confirm('回滚到版本 ${num}?当前内容会先存入新版本记录。')">
            <button class="btn btn-sm" type="submit">回滚</button>
          </form>
        </td>
      </tr>`
    })
    .join('\n')

  return renderAdminLayout({
    title: '版本历史 · 文章 ' + articleId,
    active: '/admin/articles', siteName, cspNonce, csrfToken,
    body: `
    <div class="section-title">
      <h2>版本历史 · 文章 #${articleId}</h2>
      <a href="/admin/articles" style="color:var(--muted);font-size:13px">← 返回内容管理</a>
    </div>
    <table class="admin-table">
      <thead>
        <tr><th>#</th><th>标题</th><th>状态</th><th>创建时间</th><th>操作</th></tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="5">暂无版本记录</td></tr>'}</tbody>
    </table>`,
  })
}
