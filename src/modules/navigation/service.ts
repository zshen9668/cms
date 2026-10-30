export type NavigationItem = {
  key: string
  label: string
  path: string
  enabled: boolean
  sortOrder: number
  mobileOrder: number
  bottom?: boolean
  group?: 'primary' | 'more'
}

/**
 * 默认导航。
 *
 * 「成功案例」取代「服务城市」进入主要位置（移动端底部栏只有 5 个位置）。
 * 城市页不放进底部栏，但仍保留在桌面导航里——否则 /city/... 会变成没有任何入口的孤岛页面，
 * 直接影响本地关键词的抓取与收录。
 */
export const DEFAULT_NAVIGATION: NavigationItem[] = [
  { key: 'home', label: '首页', path: '/', enabled: true, sortOrder: 1, mobileOrder: 1, bottom: true, group: 'primary' },
  { key: 'services', label: '服务项目', path: '/service', enabled: true, sortOrder: 2, mobileOrder: 2, bottom: true, group: 'primary' },
  { key: 'cases', label: '成功案例', path: '/case', enabled: true, sortOrder: 3, mobileOrder: 3, bottom: true, group: 'primary' },
  { key: 'cities', label: '服务城市', path: '/city', enabled: true, sortOrder: 4, mobileOrder: 4, bottom: false, group: 'primary' },
  { key: 'articles', label: '新闻资讯', path: '/article', enabled: true, sortOrder: 5, mobileOrder: 5, bottom: true, group: 'primary' },
  { key: 'about', label: '关于我们', path: '/about', enabled: true, sortOrder: 6, mobileOrder: 6, bottom: false, group: 'more' },
  { key: 'contact', label: '联系我们', path: '/contact', enabled: true, sortOrder: 7, mobileOrder: 7, bottom: true, group: 'primary' },
]

export const NAVIGATION_KEY = 'navigation_json'

export function getNavigation(settings: Record<string, string>, labelOverrides?: Partial<Record<string, string>>): NavigationItem[] {
  let saved: unknown = []
  try {
    saved = JSON.parse(settings[NAVIGATION_KEY] || settings.navigation_items || '[]')
  } catch {
    saved = []
  }

  const map = new Map(
    (Array.isArray(saved) ? saved : []).map((item: any) => [String(item.key || item.path), item]),
  )

  return DEFAULT_NAVIGATION
    .map((item) => {
      const override = map.get(item.key) || map.get(item.path) || {}
      const label =
        (labelOverrides && labelOverrides[item.key]) ||
        String((override as any).label || item.label)
      return {
        ...item,
        label: label.slice(0, 50),
        enabled: (override as any).enabled !== false,
        sortOrder: Number((override as any).sortOrder ?? (override as any).sort ?? item.sortOrder),
        mobileOrder: Number((override as any).mobileOrder ?? (override as any).sortOrder ?? (override as any).sort ?? item.mobileOrder),
        // bottom / group 必须从保存值读回：旧实现只 spread 默认值，
        // 后台「底部栏」勾选框改了也不生效（保存了但读不回来）。
        bottom: typeof (override as any).bottom === 'boolean' ? (override as any).bottom : item.bottom,
        group: (override as any).group === 'more' || (override as any).group === 'primary'
          ? (override as any).group
          : item.group,
      }
    })
    .filter((item) => item.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export function getBottomNavigation(items: NavigationItem[]): NavigationItem[] {
  return [...items].filter((item) => item.bottom !== false && item.group !== 'more').sort((a, b) => a.mobileOrder - b.mobileOrder).slice(0, 5)
}

export function getMobileNavigation(items: NavigationItem[]): NavigationItem[] {
  return [...items].sort((a, b) => a.mobileOrder - b.mobileOrder)
}

export function serializeNavigation(items: NavigationItem[]): string {
  return JSON.stringify(
    items.map((item) => ({
      key: item.key,
      label: String(item.label || '').slice(0, 50),
      path: item.path,
      enabled: item.enabled !== false,
      sortOrder: Number(item.sortOrder || 0),
      mobileOrder: Number(item.mobileOrder || item.sortOrder || 0),
      // bottom / group 必须落库：否则后台「底部栏」勾选框保存后读不回来，
      // 表现为"改了没反应"（getBottomNavigation 只能拿到默认值）。
      bottom: item.bottom !== false,
      group: item.group === 'more' ? 'more' : 'primary',
    })),
  )
}
