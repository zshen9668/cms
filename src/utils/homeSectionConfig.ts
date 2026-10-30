// 首页模块的键、默认顺序与显示/隐藏解析。与模板分离,便于单独测试。
//
// 'cases' 取代了原来的 'cities'：前台首页展示成功案例而不是服务城市列表。
// 城市页 /city/... 仍然存在并进入 sitemap，只是不再占据首页一个模块位。
export const HOME_SECTION_KEYS = ['intro', 'services', 'cases', 'articles', 'contact'] as const
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number]

export const DEFAULT_HOME_SECTION_ORDER: HomeSectionKey[] = [...HOME_SECTION_KEYS]

export type HomeSectionSlot = { key: HomeSectionKey; visible: boolean }

export function parseHomeSectionOrder(raw: unknown): HomeSectionSlot[] {
  const picked: HomeSectionSlot[] = []
  for (const part of String(raw || '').split(',')) {
    const visible = !part.trim().startsWith('-')
    const key = part.trim().replace(/^-/, '') as HomeSectionKey
    if ((HOME_SECTION_KEYS as readonly string[]).includes(key) && !picked.some((slot) => slot.key === key)) {
      picked.push({ key, visible })
    }
  }
  for (const key of HOME_SECTION_KEYS) if (!picked.some((slot) => slot.key === key)) picked.push({ key, visible: true })
  return picked
}

