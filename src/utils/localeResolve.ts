// 纯函数、无外部依赖：语言解析规则集中在这里，便于单元测试。
//
// 产品策略（第二阶段起）：前台支持「中文 + English」双语。
// - 后台「导航与联系 → 语言」里可以分别启停 zh-CN / en，并指定默认语言；
// - 语言解析优先级：显式 Cookie（用户点过语言切换）→ 已启用语言里能匹配上的
//   Accept-Language → 默认语言；
// - 只启用一种语言时，解析结果恒为该语言（此时前台不显示语言切换），
//   与历史「仅中文」版本的对外表现完全一致。
//
// 历史字段名（titleEn / labelEn / seoKeywordsEn）保留不变：它们表达的是
// 「英文版本内容」，与语言是否启用是两件事。
export const SUPPORTED = ['zh-CN', 'en'] as const
export type Locale = typeof SUPPORTED[number]
export const DEFAULT_LOCALE: Locale = 'zh-CN'

/** 语言展示名（语言切换器与后台面板共用）。 */
export const LOCALE_NAMES: Record<Locale, string> = {
  'zh-CN': '中文',
  en: 'English',
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED as readonly string[]).includes(value)
}

/** 把任意语言标记（en-US、EN、zh-Hans…）归一到受支持的语言。 */
export function normalizeLocale(value: unknown): Locale | null {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  if (raw === 'en' || raw.startsWith('en-') || raw.startsWith('en_')) return 'en'
  if (raw === 'zh' || raw.startsWith('zh-') || raw.startsWith('zh_')) return 'zh-CN'
  return null
}

/**
 * 从语言设置里解析出「前台已启用的语言」。
 * - 只认受支持的语言码，忽略未知项；
 * - 去重并保持配置顺序；
 * - 未配置或全部停用时回落到 [DEFAULT_LOCALE]（前台不会变成空白语言）。
 */
export function enabledLocalesFrom(items?: Array<{ code: string; enabled?: boolean }> | null): Locale[] {
  if (!Array.isArray(items)) return [DEFAULT_LOCALE]
  const out: Locale[] = []
  for (const item of items) {
    const code = normalizeLocale(item?.code)
    // enabled 缺省视为启用（历史数据里只有 code 的条目仍应生效）
    if (!code || item?.enabled === false) continue
    if (!out.includes(code)) out.push(code)
  }
  return out.length ? out : [DEFAULT_LOCALE]
}

/** 从语言设置里解析默认语言；未配置或未启用时回落到第一个已启用语言。 */
export function defaultLocaleFrom(items?: Array<{ code: string; enabled?: boolean; default?: boolean }> | null): Locale {
  const enabled = enabledLocalesFrom(items)
  if (Array.isArray(items)) {
    for (const item of items) {
      const code = normalizeLocale(item?.code)
      if (item?.default === true && code && enabled.includes(code)) return code
    }
  }
  return enabled[0] ?? DEFAULT_LOCALE
}

/**
 * 语言选择。
 * @param cookieLang   用户点语言切换时写入的 lang cookie
 * @param acceptLanguage 浏览器 Accept-Language
 * @param enabled      前台已启用的语言（未传时视为全部受支持语言）
 */
export function resolveLocale(
  cookieLang?: string,
  acceptLanguage?: string,
  enabled: readonly Locale[] = SUPPORTED,
): Locale {
  const allowed = enabled.length ? enabled : [DEFAULT_LOCALE]

  // 1) Cookie 是用户的显式选择，优先级最高；但用户选过的语言可能已被后台停用。
  const fromCookie = normalizeLocale(cookieLang)
  if (fromCookie && allowed.includes(fromCookie)) return fromCookie

  // 2) Accept-Language 按 q 值降序尝试；带 q=0 的条目表示"明确不要"。
  for (const tag of parseAcceptLanguage(acceptLanguage)) {
    const normalized = normalizeLocale(tag)
    if (normalized && allowed.includes(normalized)) return normalized
  }

  // 3) 兜底：默认语言（zh-CN 在启用列表里就一定是它）
  return allowed.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : (allowed[0] ?? DEFAULT_LOCALE)
}

/**
 * 解析 Accept-Language，返回按 q 值降序的语言标记。
 * 只做浏览器实际会用到的语法：tag;q=0.9, tag, *  —— 通配符不参与匹配（交由默认语言兜底）。
 */
export function parseAcceptLanguage(header?: string): string[] {
  const raw = String(header || '')
  if (!raw.trim()) return []
  return raw
    .split(',')
    .map((part) => {
      const [tagRaw, ...params] = part.split(';')
      const tag = String(tagRaw || '').trim()
      let q = 1
      for (const param of params) {
        const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param)
        if (match) {
          const parsed = Number(match[1] ?? '')
          q = Number.isFinite(parsed) ? parsed : 0
        }
      }
      return { tag, q }
    })
    .filter((item) => item.tag && item.tag !== '*' && item.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((item) => item.tag)
}
