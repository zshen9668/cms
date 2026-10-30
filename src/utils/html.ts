/**
 * HTML 转义(全站唯一实现)。
 *
 * 之前这段逻辑在 5 个文件里各写了一份(`templates/layout.ts` 导出版 + `cron/newsCollector.ts`、
 * `routes/admin/news.ts`、`templates/adminCases.ts`、`templates/adminSystemSecrets.ts` 的本地副本)。
 * 重复实现的风险不是"多几行",而是**哪天需要补一个字符(例如反引号)时漏改其中一处**,
 * 于是同一份数据在不同页面被转义成不同结果——这类漏洞只在特定输入下才暴露。
 *
 * 覆盖 HTML 文本与双/单引号属性值两类上下文所需的 5 个字符。
 * 注意:它只做转义,不做白名单过滤;需要剔除标签请用 `sanitizeAiPublicHtml`。
 */
export function escapeHtml(value: string | undefined | null): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch),
  )
}
