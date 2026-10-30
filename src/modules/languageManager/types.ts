import { DEFAULT_LOCALE, LOCALE_NAMES, type Locale } from '../../utils/localeResolve'

export type LanguageOption = {
  code: string
  name: string
  enabled: boolean
  default?: boolean
}

/**
 * 前台默认语言列表：中文（默认）+ English。
 * 两者都默认启用，因此全新站点开箱即可用 /lang/en 切换；
 * 只想做中文站的站长可以在「导航与联系 → 语言」里关掉 English，
 * 关掉后前台不会渲染语言切换器，解析结果恒为中文（与旧版行为一致）。
 */
export const DEFAULT_LANGUAGES: LanguageOption[] = [
  { code: 'zh-CN', name: LOCALE_NAMES['zh-CN'], enabled: true, default: true },
  { code: 'en', name: LOCALE_NAMES.en, enabled: true },
]

export const LANGUAGE_CODES = ['zh-CN', 'en'] as const
export type LanguageCode = typeof LANGUAGE_CODES[number]

export const LANGUAGES_KEY = 'languages'

/** 语言码对应的展示名；未知语言码原样返回，避免后台出现空白标签。 */
export function languageDisplayName(code: string): string {
  return LOCALE_NAMES[code as Locale] || String(code || '')
}

/** 默认语言码（未配置时是 zh-CN）。 */
export { DEFAULT_LOCALE }
