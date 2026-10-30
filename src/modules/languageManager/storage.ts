import { safeError } from '../../utils/safeLogger'
import type { Bindings } from '../../types'
import { DEFAULT_LANGUAGES, LANGUAGES_KEY, languageDisplayName, type LanguageOption } from './types'
import {
  defaultLocaleFrom, enabledLocalesFrom, normalizeLocale, type Locale,
} from '../../utils/localeResolve'
import { SettingsStore } from '../../utils/settingsStore'

/**
 * 语言配置归一化。
 *
 * 历史版本这里无条件丢弃配置、强制只返回中文（产品锁定仅中文）。
 * 现在恢复为读写真实配置，但必须保证：
 *  - 只接受受支持的语言码（未知码丢弃，避免前台解析出无法渲染的语言）；
 *  - 同一语言码去重；
 *  - 恰好一个默认语言，且默认语言必须是已启用的语言（否则前台语言解析会落到空值）；
 *  - 至少保留一种启用语言（全部停用等于前台没有语言）。
 */
function normalize(items: any[]): LanguageOption[] {
  const seen = new Set<string>()
  const out: LanguageOption[] = []
  for (const item of Array.isArray(items) ? items : []) {
    const code = normalizeLocale(item?.code)
    if (!code || seen.has(code)) continue
    seen.add(code)
    out.push({
      code,
      name: String(item?.name || '').trim().slice(0, 40) || languageDisplayName(code),
      enabled: item?.enabled !== false,
      default: item?.default === true,
    })
  }

  if (!out.length) return DEFAULT_LANGUAGES.map((x) => ({ ...x }))

  // 全部被停用时，启用中文（存在则启用中文，否则启用第一项），避免出现"没有语言"的前台。
  if (!out.some((x) => x.enabled)) {
    const fallback = out.find((x) => x.code === 'zh-CN') || out[0]!
    fallback.enabled = true
  }

  // 默认语言必须存在且已启用；否则把第一个启用项设为默认。
  const enabled = out.filter((x) => x.enabled)
  const currentDefault = out.find((x) => x.default && x.enabled)
  if (!currentDefault) {
    for (const item of out) item.default = false
    const preferred = enabled.find((x) => x.code === 'zh-CN') || enabled[0]!
    preferred.default = true
  }

  return out
}

export async function getLanguages(env: Bindings, tenantId = 1): Promise<LanguageOption[]> {
  if (!env.DB) return DEFAULT_LANGUAGES.map((x) => ({ ...x }))
  try {
    const value = await SettingsStore.forTenant(env, tenantId).get(LANGUAGES_KEY)
    if (!value) return DEFAULT_LANGUAGES.map((x) => ({ ...x }))
    const items = JSON.parse(String(value))
    return Array.isArray(items) ? normalize(items) : DEFAULT_LANGUAGES.map((x) => ({ ...x }))
  } catch {
    return DEFAULT_LANGUAGES.map((x) => ({ ...x }))
  }
}

export function getLanguagesFromSettings(settings: Record<string, string>): LanguageOption[] {
  try {
    const items = settings.languages ? JSON.parse(settings.languages) : null
    return Array.isArray(items) ? normalize(items) : DEFAULT_LANGUAGES.map((x) => ({ ...x }))
  } catch {
    return DEFAULT_LANGUAGES.map((x) => ({ ...x }))
  }
}

export async function saveLanguages(env: Bindings, items: LanguageOption[], tenantId = 1): Promise<void> {
  if (!env.DB) throw new Error('D1 is required')
  const normalized = normalize(items || DEFAULT_LANGUAGES)
  await SettingsStore.forTenant(env, tenantId).set(LANGUAGES_KEY, JSON.stringify(normalized))
  invalidateEnabledLocalesCache()
}

/** 前台默认语言（用于 languageManager 之外的调用点，如后台语言面板、hreflang）。 */
export async function getDefaultLocale(env: Bindings, tenantId = 1): Promise<Locale> {
  return (await getLanguageConfig(env, tenantId)).defaultLocale
}

// ---------- 前台语言配置（isolate 内缓存 60 秒，避免每个请求都多一次 D1 查询） ----------
const ENABLED_LOCALES_TTL_MS = 60_000
let languageConfigCache: { at: number; value: { enabled: Locale[]; defaultLocale: Locale } } | null = null

/**
 * 返回前台已启用语言与默认语言。
 * 读不到配置时返回「仅默认中文」——宁可少渲染一种语言，
 * 也不要在设置表异常时把前台切成未配置的语言。
 */
export async function getLanguageConfig(env: Bindings, tenantId = 1): Promise<{ enabled: Locale[]; defaultLocale: Locale }> {
  const now = Date.now()
  if (languageConfigCache && now - languageConfigCache.at < ENABLED_LOCALES_TTL_MS) return languageConfigCache.value
  if (!env.DB) {
    const fallback = { enabled: enabledLocalesFrom(null), defaultLocale: defaultLocaleFrom(null) }
    return fallback
  }
  try {
    const rawValue = await SettingsStore.forTenant(env, tenantId).get(LANGUAGES_KEY)
    let items: LanguageOption[] = DEFAULT_LANGUAGES
    if (rawValue) {
      const parsed = JSON.parse(String(rawValue))
      if (Array.isArray(parsed)) items = normalize(parsed)
    }
    const value = { enabled: enabledLocalesFrom(items), defaultLocale: defaultLocaleFrom(items) }
    languageConfigCache = { at: now, value }
    return value
  } catch (e) {
    safeError('load language config failed; falling back to default locale', e)
    return { enabled: enabledLocalesFrom(null), defaultLocale: defaultLocaleFrom(null) }
  }
}

/** 只取启用语言名单，兼容既有调用点。 */
export async function getEnabledLocales(env: Bindings, tenantId = 1): Promise<Locale[]> {
  return (await getLanguageConfig(env, tenantId)).enabled
}

/** 后台保存语言设置后立即让本 isolate 的缓存失效（其它 isolate 最多 60 秒后生效）。 */
export function invalidateEnabledLocalesCache() {
  languageConfigCache = null
}
