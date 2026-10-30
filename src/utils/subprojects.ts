export type SubprojectSection = 'service' | 'article' | 'new' | 'city'
export type SubprojectLayout = 'grid' | 'list' | 'feature'

export const SUBPROJECT_SECTIONS: Array<{ key: SubprojectSection; label: string; path: string; itemType: 'service' | 'article' | 'city' }> = [
  { key: 'service', label: '服务子项目', path: '/service', itemType: 'service' },
  { key: 'article', label: '资讯子项目', path: '/article', itemType: 'article' },
  { key: 'new', label: '新闻专题', path: '/new', itemType: 'article' },
  { key: 'city', label: '城市子项目', path: '/city', itemType: 'city' },
]

export function normalizeSubprojectSlug(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
}

export function normalizeSubprojectLayout(value: unknown): SubprojectLayout {
  return value === 'list' || value === 'feature' ? value : 'grid'
}

export function parseSubprojectItems(values: unknown): number[] {
  const list = Array.isArray(values) ? values : values ? [values] : []
  return Array.from(new Set(list
    .map((value) => Number(String(value)))
    .filter((value) => Number.isInteger(value) && value > 0)
  )).slice(0, 200)
}

export function subprojectPagePath(section: SubprojectSection, slug: string): string {
  if (section === 'service') return '/service/topic/' + slug
  if (section === 'article') return '/article/tag/' + slug
  if (section === 'new') return '/new/' + slug
  return '/city/topic/' + slug
}
