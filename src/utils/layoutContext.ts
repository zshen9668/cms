import type { Bindings } from '../types'
import type { Locale } from './i18n'
import { defaultLocaleFrom } from './localeResolve'
import { getPageNavigationLabels } from './pageSettings'
import type { ContactMethods } from './contactSettings'
import { getNavigation } from '../modules/navigation/service'
import { getLanguagesFromSettings } from '../modules/languageManager'
import { channelsToContactMethods, getActiveContactChannels } from '../modules/contactChannels'
import { getFooterSettings } from './footerSettings'
import { SettingsStore } from './settingsStore'
import type { LayoutAuthor } from '../templates/layout'

/** 官方主页链接（Organization.sameAs）：只接受绝对 http(s) 地址。 */
function splitProfileLinks(value: unknown): string[] {
  return String(value || '')
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, 10)
}

function splitExpertise(value: unknown): string[] {
  return Array.from(new Set(
    String(value || '')
      .split(/[,，;；\n、|]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  )).slice(0, 8)
}

/**
 * 站点级作者实体（E-E-A-T）。
 * AI 引擎判断内容可信度时，"谁写的、凭什么信"比正文本身更关键，
 * 因此把署名、职位、资质与专长领域输出成 Person 结构化数据。
 * 未配置署名时返回 undefined，不输出半成品实体。
 */
function buildSiteAuthor(settings: Record<string, string>): LayoutAuthor | undefined {
  const name = String(settings.site_author_name || '').trim()
  if (!name) return undefined
  const expertise = splitExpertise(settings.site_author_expertise)
  return {
    name: name.slice(0, 80),
    url: String(settings.site_author_url || '').trim().slice(0, 300) || undefined,
    jobTitle: String(settings.site_author_title || '').trim().slice(0, 80) || undefined,
    credentials: String(settings.site_author_credentials || '').trim().slice(0, 200) || undefined,
    knowsAbout: expertise.length ? expertise : undefined,
  }
}

/**
 * Build shared layout options (nav + languages + contact + footer) from settings map.
 * Prefer generic contact_channels when present; fall back to legacy fields.
 * contactChannels is passed separately so each frontend surface can honor display flags.
 */
export function buildLayoutChrome(
  settings: Record<string, string>,
  locale: Locale,
  contactOverride?: ContactMethods,
) {
  const navLabels = getPageNavigationLabels(settings, locale)
  const navItems = getNavigation(settings, navLabels)
  const languages = getLanguagesFromSettings(settings)
  const contactChannels = getActiveContactChannels(settings)
  const base = channelsToContactMethods(contactChannels)
  const contactMethods: ContactMethods = contactOverride
    ? {
        phones: contactOverride.phones?.length ? contactOverride.phones : base.phones,
        wechats: contactOverride.wechats?.length ? contactOverride.wechats : base.wechats,
        qqs: contactOverride.qqs?.length ? contactOverride.qqs : base.qqs,
      }
    : base
  const siteName = String(settings.site_name || settings.site_profile_name || '').trim()
  const footer = getFooterSettings(settings, siteName, locale)
  return {
    navLabels,
    navItems,
    languages,
    // 默认语言决定 canonical 与 hreflang：非默认语言页面会带上 ?lang=xx。
    defaultLocale: defaultLocaleFrom(languages),
    // 前台问答组件：设置里显式写 '0' 才算关闭（缺省视为开启，与后端默认一致）。
    aiQa: { enabled: settings.ai_qa_enabled !== '0' },
    aiQaTurnstileSiteKey: settings.turnstile_site_key || '',
    contactMethods,
    contactChannels,
    footerCopyright: footer.copyright,
    footerDisclaimer: footer.disclaimer,
    footerAiNotice: footer.aiNotice,
    footerLinks: footer.links,
    // 站点级 GEO 实体：一次配置，全站每一个页面都会带上。
    author: buildSiteAuthor(settings),
    logoUrl: String(settings.site_logo_url || '').trim() || undefined,
    defaultImage: String(settings.site_og_image || '').trim() || undefined,
    sameAs: splitProfileLinks(settings.site_social_links),
    // 前台 CTA 悬浮区块：开关与文案。
    siteCtaEnabled: settings.site_cta_enabled,
    siteCtaTitle: settings.site_cta_title || '联系我们',
    siteCtaSubtitle: settings.site_cta_subtitle || '有需求？立即咨询',
    siteCtaBtnText: settings.site_cta_btn_text || '立即咨询',
    // 前台统计脚本注入。
    siteAnalyticsEnabled: settings.site_analytics_enabled,
    siteAnalyticsSnippet: settings.site_analytics_snippet || '',
    // 站点图标：前台 <link rel="icon"> 用，留空则不输出（保留原有 apple-touch-icon）。
    siteFavicon: String(settings.site_favicon || '').trim() || undefined,
  }
}

export async function loadSettingsMap(env: Bindings, tenantId = 1): Promise<Record<string, string>> {
  if (!env.DB) return {}
  try {
    return await SettingsStore.forTenant(env, tenantId).getMap('all')
  } catch {
    return {}
  }
}
