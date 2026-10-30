import type { Bindings } from '../types'
import { PLATFORM_LIST, type PlatformKey } from './socialPlatforms'
import { generateSocialContent } from './socialFormat'

type SyncResult = { platform: PlatformKey; ok: boolean; skipped?: boolean; error?: string }

// 人工发布成功后的国内内容/视频平台同步层：只生成并保存发布包，不接管账号登录。
export async function syncPublishedArticleToDomesticPlatforms(env: Bindings, articleId: number): Promise<{ ok: boolean; results: SyncResult[] }> {
  const article = await env.DB.prepare("SELECT id, title, summary, content, seo_keywords, city_id, status FROM articles WHERE id=? LIMIT 1").bind(articleId).first() as any
  if (!article || String(article.status || '') !== 'published') return { ok: false, results: [] }
  const city = article.city_id ? await env.DB.prepare('SELECT name FROM cities WHERE id=? LIMIT 1').bind(article.city_id).first() as any : null
  const cityName = String(city?.name || '')
  const rows = (await env.DB.prepare('SELECT platform, status FROM social_posts WHERE article_id=?').bind(articleId).all()).results as any[]
  const state = new Map<string, string>()
  for (const row of rows) state.set(String(row.platform || ''), String(row.status || ''))
  const results = await Promise.all(PLATFORM_LIST.map(async (platform): Promise<SyncResult> => {
    const current = state.get(platform.key)
    if (current && current !== 'not_synced') return { platform: platform.key, ok: true, skipped: true }
    try {
      const data = await generateSocialContent(env, platform.key, { title: String(article.title || ''), summary: String(article.summary || ''), content: String(article.content || ''), seo_keywords: String(article.seo_keywords || ''), cityName }, 1)
      await env.DB.prepare("INSERT INTO social_posts (article_id, platform, title, content, hashtags, ai_generated, status, synced_at) VALUES (?, ?, ?, ?, ?, 1, 'ready', datetime('now')) ON CONFLICT(article_id, platform) DO UPDATE SET title=excluded.title, content=excluded.content, hashtags=excluded.hashtags, ai_generated=1, status='ready', synced_at=datetime('now')").bind(articleId, platform.key, data.title, data.content, data.hashtags.join(',')).run()
      return { platform: platform.key, ok: true }
    } catch (e) {
      return { platform: platform.key, ok: false, error: String((e as any)?.message || e || '生成失败').slice(0, 500) }
    }
  }))
  return { ok: results.every((item) => item.ok), results }
}