import { safeError } from './safeLogger'
import type { Bindings } from '../types'
import { getAiSettings, runConfiguredAi } from './aiSettings'
import { composeAiPrompt, getAiPromptSettings } from './aiPrompts'
import { getSiteProfile } from './siteProfile'
import { getAiResponseText, parseAiJson } from './aiJson'
import { normalizeKeywordCandidates } from './autoSeo'
import { SettingsStore } from './settingsStore'

function normalizeKeyword(value: unknown): string {
  return String(value || '')
    .replace(/[\u0000\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

export async function generateAiKeywords(
  env: Bindings,
  tenantId: number,
  context: {
    cities?: string[]
    services?: string[]
    existingKeywords?: string
  },
): Promise<string[]> {
  const promptSettings = await getAiPromptSettings(env, tenantId)
  const aiSettings = await getAiSettings(env, tenantId)
  let siteSettings: Record<string, string> = {}
  try {
    siteSettings = await SettingsStore.forTenant(env, tenantId).getMany([
      'site_name', 'site_topic', 'site_industry', 'site_description',
      'primary_services', 'primary_keywords', 'news_categories', 'site_keywords',
    ])
  } catch (e) {
    safeError('AI keyword site profile load failed; using defaults', e)
  }
  const siteProfile = getSiteProfile(siteSettings, env.SITE_NAME || '')
  const prompt = composeAiPrompt(promptSettings, 'keyword', {
    siteName: siteProfile.siteName || env.SITE_NAME || '企业服务',
    keywords: String(context.existingKeywords || '').slice(0, 3000),
    cities: (context.cities || []).slice(0, 30).join('、'),
    services: (context.services || []).slice(0, 30).join('、'),
    task: '生成可用于全站SEO的新增搜索关键词，必须围绕当前网站主题和主营服务。',
  }, aiSettings, undefined, siteProfile)

  const res: any = await runConfiguredAi(
    env,
    { messages: [{ role: 'user', content: prompt }] },
    aiSettings,
  )
  if (!res) return []

  const responseText = getAiResponseText(res).trim()
  const raw = parseAiJson(responseText) as any
  const source = Array.isArray(raw?.keywords) ? raw.keywords : Array.isArray(raw?.data?.keywords) ? raw.data.keywords : typeof raw?.keywords === 'string' ? raw.keywords.split(/[,，;；\n、]+/) : typeof raw?.response === 'string' ? raw.response.split(/[,，;；\n、]+/) : responseText.split(/[,，;；\n、]+/)
  const existing = new Set((context.existingKeywords || '').split(/[,，;；\n]+/).map(normalizeKeyword).filter(Boolean).map((value) => value.toLocaleLowerCase()))
  const normalized = source
    .map((value: unknown) => normalizeKeyword(value))
    .filter((value: string) => Boolean(value) && !existing.has(value.toLocaleLowerCase()))
  // 全站关键词只是“主题候选词”；最终页面 seo_keywords 统一由页面级规则收敛到 3-5 个。
  return normalizeKeywordCandidates(normalized, 12)
}
