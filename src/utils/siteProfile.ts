import type { Bindings } from '../types'
import { SettingsStore } from './settingsStore'

export const SITE_PROFILE_KEYS = [
  'site_name', 'site_topic', 'site_industry', 'site_description',
  'target_customers', 'service_features', 'application_scenarios',
  'primary_services', 'primary_keywords', 'industry_keywords', 'news_categories', 'site_keywords',
] as const

export type SiteProfileKey = (typeof SITE_PROFILE_KEYS)[number]

export type SiteProfile = {
  siteName: string
  topic: string
  industry: string
  description: string
  /** 目标客户人群，用于 AI 内容生成和页面文案 */
  targetCustomers: string
  /** 服务特色 / 核心优势，用于 AI 内容生成和页面文案 */
  serviceFeatures: string
  /** 适用场景，用于 AI 内容生成和页面文案 */
  applicationScenarios: string
  primaryServices: string[]
  primaryKeywords: string[]
  industryKeywords: string[]
  siteKeywords: string[]
  newsCategories: string[]
}

function splitList(value: unknown, max = 20): string[] {
  return Array.from(new Set(
    String(value || '')
      .split(/[,，;；\n、|]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  )).slice(0, max)
}

/**
 * 白标站点画像。
 * settings 优先；新站默认保持空白行业画像。
 */
export function getSiteProfile(
  settings: Record<string, string> = {},
  envSiteName = '',
): SiteProfile {
  const siteName = String(settings.site_name || envSiteName || '').trim()
  const topic = String(settings.site_topic || '').trim()
  const industry = String(settings.site_industry || '').trim()
  const description = String(settings.site_description || '').trim()
  const targetCustomers = String(settings.target_customers || '').trim()
  const serviceFeatures = String(settings.service_features || '').trim()
  const applicationScenarios = String(settings.application_scenarios || '').trim()
  const primaryServices = splitList(
    settings.primary_services || '',
    12,
  )
  const primaryKeywords = splitList(
    settings.primary_keywords || settings.site_keywords || '',
    20,
  )
  const industryKeywords = splitList(
    settings.industry_keywords || '',
    30,
  )
  const siteKeywords = splitList(
    settings.site_keywords || '',
    20,
  )
  const newsCategories = splitList(
    settings.news_categories || '',
    10,
  )

  return {
    siteName,
    topic,
    industry,
    description,
    targetCustomers,
    serviceFeatures,
    applicationScenarios,
    primaryServices,
    primaryKeywords,
    industryKeywords,
    siteKeywords,
    newsCategories,
  }
}

export async function loadSiteProfileSettings(
  env: Pick<Bindings, 'DB'>,
  tenantId = 1,
): Promise<Record<string, string>> {
  try {
    return await SettingsStore.forTenant(env, tenantId).getMany(SITE_PROFILE_KEYS)
  } catch {
    // Keep the public/cron/AI paths usable when settings are temporarily unavailable.
    return {}
  }
}

export function getGlobalSeoKeywords(profile: SiteProfile, max = 20): string[] {
  return splitList(
    [
      ...profile.primaryKeywords,
      ...profile.industryKeywords,
      ...profile.siteKeywords,
    ].join(','),
    Math.max(1, Math.min(30, Math.trunc(Number(max) || 20))),
  )
}
