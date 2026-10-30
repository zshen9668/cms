export type NavCategory = { name: string; path: string; count: number }

export function articleCategoryMenu(rows: Array<{ category?: string | null }>, max = 8): NavCategory[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const name = String(row.category || '').trim().slice(0, 30)
    if (!name) continue
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, max)
    .map(([name, count]) => ({ name, path: '/article/category/' + encodeURIComponent(name), count }))
}
