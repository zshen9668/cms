/**
 * 占位符模板填充：把 {site_name}、{keyword} 等占位符替换为对应值。
 * 用于站点默认标题/描述模板（site_default_title_template / site_default_desc_template）。
 *
 * - 未知占位符保留原样，避免意外吃掉用户模板里的合法文本；
 * - 缺失值替换为空串，避免模板里残留未填充的占位符。
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}
