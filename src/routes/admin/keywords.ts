import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { readSettingsMap, saveSetting, getKeywordList, getSeoGeneratedPageStats, cleanupInvalidSeoGeneratedPages, deleteSitemapLandingPages, deletePublishedAiArticles, deleteAllGeneratedSeoData, deleteDuplicateKeywordRows, rescoreAllKeywords, generateKeywordMatrix, aiEmptyResultMessage, getTenantId } from './shared'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { safeError } from '../../utils/safeLogger'
import { purgeCacheAll } from '../../middleware/cache'
import { renderKeywordsList, renderKeywordForm } from '../../templates/admin'
import { generateAiPageContent } from '../../utils/aiPageContent'
import { getAiSettings } from '../../utils/aiSettings'
import { generateAiKeywords } from '../../utils/aiKeywords'
import { aiContentSettingKey, getAiContentStore } from '../../utils/aiContentStore'
import { normalizeKeywordCandidates } from '../../utils/autoSeo'
import { errorMessage } from '../../utils/errors'

export const adminKeywordsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

adminKeywordsRoutes.get('/keywords', async (c) => {
  const tenantId = getTenantId(c)
  const [rowsResult, settings, seoStats] = await Promise.all([
    c.env.DB.prepare(`SELECT k.*, ci.name as city_name, ci.slug as city_slug, s.name as service_name, s.slug as service_slug FROM keywords k LEFT JOIN cities ci ON ci.id = k.city_id LEFT JOIN services s ON s.id = k.service_id WHERE k.tenant_id = ? ORDER BY k.opportunity_score DESC LIMIT 200`).bind(tenantId).all(),
    readSettingsMap(c.env, tenantId),
    getSeoGeneratedPageStats(c.env, tenantId),
  ])
  // 候选词库必须回显 site_keywords 本身。
  // 旧实现回显 getGlobalSeoKeywords()（primary_keywords + industry_keywords + site_keywords 合并后截断），
  // 站长改完保存、页面刷新又变回合并结果，看起来就是“固定关键词无法修改”。
  const siteKeywords = String(settings.site_keywords || '')
  const rows = rowsResult.results
  const params = {
    cleanedCount: String(c.req.query('cleaned') || '').trim(),
    duplicateCleaned: String(c.req.query('duplicate_cleaned') || '').trim(),
    cleanedPages: String(c.req.query('cleaned_pages') || '').trim(),
    cleanedArticles: String(c.req.query('cleaned_articles') || '').trim(),
    lowScoreArticles: String(c.req.query('low_score_articles') || '').trim(),
    aiScoreThreshold: String(c.req.query('ai_score_threshold') || '65').trim(),
    allGeneratedKeywords: String(c.req.query('all_generated_keywords') || '').trim(),
    allGeneratedArticles: String(c.req.query('all_generated_articles') || '').trim(),
    allGeneratedAiPages: String(c.req.query('all_generated_ai_pages') || '').trim(),
  }
  const message = c.req.query('error')
    || (c.req.query('keywords_saved') === '1' ? '固定关键词（全站候选词库）已保存；不会被“一键规范全部页面 SEO”自动改写。' : '')
    || (c.req.query('ai') === '1' ? 'AI关键词已生成并追加到全站候选词库；页面 SEO 仍按各页面主题单独规范。' : '')
    || (params.allGeneratedKeywords || params.allGeneratedArticles || params.allGeneratedAiPages
      ? '生产库全量清理完成：SEO关键词 ' + (params.allGeneratedKeywords || '0') + ' 条；AI文章 ' + (params.allGeneratedArticles || '0') + ' 篇；AI SEO页面设置 ' + (params.allGeneratedAiPages || '0') + ' 条；已同步删除文章审核日志/社交分发关联记录，并在返回前清理公开缓存。'
      : (params.cleanedCount || params.duplicateCleaned || params.cleanedPages || params.cleanedArticles || params.lowScoreArticles
        ? '生产库清理完成：无效关键词 ' + (params.cleanedCount || '0') + ' 条；重复关键词 ' + (params.duplicateCleaned || '0') + ' 条；有效 Sitemap SEO 落地页 ' + (params.cleanedPages || '0') + ' 个；已发布 AI 文章 ' + (params.cleanedArticles || '0') + ' 篇；AI评分低于 ' + params.aiScoreThreshold + ' 的已发布 AI 文章 ' + (params.lowScoreArticles || '0') + ' 篇，并已同步清理关联日志/分发记录及公开缓存。'
        : ''))
  const cleanupPending = seoStats.keywordCleanup + seoStats.duplicateKeywords + seoStats.invalidTotal
  return c.html(renderKeywordsList(rows as any, siteKeywords, message, cleanupPending, seoStats))
})

adminKeywordsRoutes.post('/keywords/ai-generate', async (c) => {
  try {
    const settings = await readSettingsMap(c.env, getTenantId(c))
    const cityRows = (await c.env.DB.prepare("SELECT name FROM cities WHERE is_active=1 ORDER BY sort_order, id LIMIT 30").all()).results as any[]
    const serviceRows = (await c.env.DB.prepare("SELECT name FROM services WHERE is_active=1 ORDER BY sort_order, id LIMIT 30").all()).results as any[]
    const existing = String(settings.site_keywords || '').trim()
    const generated = await generateAiKeywords(c.env, getTenantId(c), {
      cities: cityRows.map((row) => String(row.name || '')).filter(Boolean),
      services: serviceRows.map((row) => String(row.name || '')).filter(Boolean),
      existingKeywords: existing,
    })
    if (!generated.length) {
      const status = await getAiSettings(c.env)
      const message = status.enabled ? aiEmptyResultMessage('AI关键词生成', status) : 'AI 功能当前已停用。'
      return c.redirect('/admin/keywords?error=' + encodeURIComponent(message))
    }
    const oldKeywords = getKeywordList(existing)
    const siteKeywords = normalizeKeywordCandidates([...oldKeywords, ...generated], 15).join(',')
    await saveSetting(c.env, 'site_keywords', siteKeywords, getTenantId(c))
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    return c.redirect('/admin/keywords?ai=1')
  } catch (e) {
    safeError('AI keyword generation failed', e)
    return c.redirect('/admin/keywords?error=' + encodeURIComponent(errorMessage(e, 'AI关键词生成失败')))
  }
})

adminKeywordsRoutes.post('/keywords/settings', async (c) => {
  const b = await c.req.parseBody()
  // 上限与 normalizeKeywordCandidates 的硬上限（20）对齐：旧实现写死 15，
  // 站长填第 16 个词会被静默丢掉，同样表现为“改了没用”。
  const siteKeywords = normalizeKeywordCandidates(String(b.site_keywords || ''), 20).join(',')
  await saveSetting(c.env, 'site_keywords', siteKeywords, getTenantId(c))
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/keywords?keywords_saved=1')
})

adminKeywordsRoutes.post('/keywords/generate', async (c) => {
  try {
    const changed = await generateKeywordMatrix(c.env)
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    return c.redirect('/admin/keywords?message=' + encodeURIComponent('关键词矩阵已生成/更新：处理 ' + changed + ' 条城市×服务记录，并按统一规则重新计算机会分。'))
  } catch (e) {
    safeError('keyword matrix generation failed', e)
    return c.redirect('/admin/keywords?error=' + encodeURIComponent('关键词矩阵生成失败：' + errorMessage(e, '未知错误')))
  }
})

adminKeywordsRoutes.post('/keywords/rescore', async (c) => {
  try {
    const changed = await rescoreAllKeywords(c.env)
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    return c.redirect('/admin/keywords?message=' + encodeURIComponent('机会分已重新计算：更新 ' + changed + ' 条关键词；页面 SEO 未被改写。'))
  } catch (e) {
    safeError('keyword rescore failed', e)
    return c.redirect('/admin/keywords?error=' + encodeURIComponent('机会分重算失败：' + errorMessage(e, '未知错误')))
  }
})

adminKeywordsRoutes.get('/keywords/:id/edit', async (c) => {
  const kw = await c.env.DB.prepare('SELECT * FROM keywords WHERE id=? AND tenant_id=?').bind(c.req.param('id'), getTenantId(c)).first()
  if (!kw) return c.notFound()
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const aiContent = await c.env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(aiContentSettingKey('landing', String((kw as any).landing_slug || ''))).first() as any
  let aiContentParsed: any = undefined
  if (aiContent?.value) try { aiContentParsed = JSON.parse(String(aiContent.value)) } catch {}
  const landingKey = String((kw as any).landing_slug || '')
  return c.html(renderKeywordForm(kw, aiContentParsed))
})

adminKeywordsRoutes.post('/keywords/:id/delete', async (c) => {
  const id = c.req.param('id')
  const tenantId = getTenantId(c)
  const kw = await c.env.DB.prepare('SELECT landing_slug FROM keywords WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!kw) return c.notFound()
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const store = getAiContentStore(settings)
  if (kw.landing_slug) delete store.landing[String(kw.landing_slug)]
  await c.env.DB.prepare('DELETE FROM keywords WHERE id=? AND tenant_id=?').bind(id, tenantId).run()
  if (kw.landing_slug) await c.env.DB.prepare('DELETE FROM settings WHERE key=?').bind(aiContentSettingKey('landing', String(kw.landing_slug))).run()
  await saveSetting(c.env, 'ai_page_content_json', JSON.stringify(store), getTenantId(c))
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/keywords')
})

adminKeywordsRoutes.post('/keywords/:id/content/delete', async (c) => {
  const id = c.req.param('id')
  const tenantId = getTenantId(c)
  const kw = await c.env.DB.prepare('SELECT landing_slug FROM keywords WHERE id=? AND tenant_id=?').bind(id, tenantId).first() as any
  if (!kw) return c.notFound()
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const store = getAiContentStore(settings)
  if (kw.landing_slug) delete store.landing[String(kw.landing_slug)]
  if (kw.landing_slug) await c.env.DB.prepare('DELETE FROM settings WHERE key=?').bind(aiContentSettingKey('landing', String(kw.landing_slug))).run()
  await saveSetting(c.env, 'ai_page_content_json', JSON.stringify(store), getTenantId(c))
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/keywords/' + id + '/edit')
})

adminKeywordsRoutes.post('/keywords/:id/ai-content', async (c) => {
  const id = c.req.param('id')
  const tenantId = getTenantId(c)
  const kw = await c.env.DB.prepare(`SELECT k.*, ci.name as city_name, ci.slug as city_slug, ci.tier as city_tier, s.name as service_name, s.slug as service_slug, s.demand_weight as service_weight FROM keywords k LEFT JOIN cities ci ON ci.id=k.city_id AND ci.tenant_id = ? LEFT JOIN services s ON s.id=k.service_id AND s.tenant_id = ? WHERE k.id=? AND k.tenant_id = ?`).bind(tenantId, tenantId, id, tenantId).first() as any
  if (!kw) return c.notFound()
  const ai = await generateAiPageContent(c.env, getTenantId(c), { type: 'landing', city: kw.city_name, service: kw.service_name, keyword: kw.keyword, weight: Number(kw.opportunity_score || 0) })
  if (!ai) {
    const status = await getAiSettings(c.env)
    return c.text(status.enabled ? aiEmptyResultMessage('AI落地页生成', status) : 'AI 功能当前已停用。', 503)
  }
  const key = kw.landing_slug || (kw.city_slug + '-' + kw.service_slug)
  await saveSetting(c.env, aiContentSettingKey('landing', key), JSON.stringify({ ...ai, weight: Number(kw.opportunity_score || 0), updatedAt: new Date().toISOString() }), getTenantId(c))
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/keywords/' + id + '/edit')
})

adminKeywordsRoutes.post('/keywords/:id/edit', async (c) => {
  const id = c.req.param('id'), tenantId = getTenantId(c), b = await c.req.parseBody()
  const searchVolume = parseInt(String(b.search_volume || '0'), 10) || 0, difficulty = String(b.difficulty || '中')
  const kw = await c.env.DB.prepare(`SELECT k.*, ci.tier as city_tier, s.demand_weight as service_weight FROM keywords k LEFT JOIN cities ci ON ci.id=k.city_id AND ci.tenant_id = ? LEFT JOIN services s ON s.id=k.service_id AND s.tenant_id = ? WHERE k.id=? AND k.tenant_id = ?`).bind(tenantId, tenantId, id, tenantId).first() as any
  if (!kw) return c.notFound()
  const score = calcOpportunityScore({ tier: kw.city_tier || '二线', serviceWeight: kw.service_weight ?? 50, difficulty, searchVolume })
  await c.env.DB.prepare('UPDATE keywords SET search_volume=?, difficulty=?, opportunity_score=?, note=?, status=? WHERE id=? AND tenant_id=?').bind(searchVolume, difficulty, score, b.note || '', b.status || kw.status, id, tenantId).run()
  return c.redirect('/admin/keywords')
})

adminKeywordsRoutes.post('/keywords/cleanup', async (c) => {
  const body = await c.req.parseBody()
  const cleanupAllGenerated = body.cleanup_all_generated === 'on', cleanupInvalid = body.cleanup_invalid === 'on', cleanupDuplicates = body.cleanup_duplicate_keywords === 'on', deleteSitemap = body.delete_sitemap_landings === 'on', deleteAiArticles = body.delete_ai_articles === 'on', deleteLowScore = body.delete_low_ai_articles === 'on'
  const thresholdRaw = Number(body.ai_score_threshold || 65), aiScoreThreshold = Math.min(100, Math.max(0, Number.isFinite(thresholdRaw) ? Math.trunc(thresholdRaw) : 65))
  const tenantId = getTenantId(c)
  let cleaned = 0, duplicateCleaned = 0, cleanedPages = 0, cleanedArticles = 0, lowScoreArticles = 0, allGeneratedKeywords = 0, allGeneratedArticles = 0, allGeneratedAiPages = 0
  if (cleanupAllGenerated) { const all = await deleteAllGeneratedSeoData(c.env, tenantId); allGeneratedKeywords = all.keywords; allGeneratedArticles = all.aiArticles; allGeneratedAiPages = all.aiPageSettings }
  else {
    if (cleanupDuplicates) duplicateCleaned = await deleteDuplicateKeywordRows(c.env, tenantId)
    if (cleanupInvalid) {
      const stale = (await c.env.DB.prepare("SELECT id FROM keywords WHERE COALESCE(opportunity_score,0) <= 0 OR city_id IS NULL OR service_id IS NULL AND tenant_id=? ORDER BY id").bind(tenantId).all()).results as any[]
      const statements = stale.map((row) => c.env.DB.prepare('DELETE FROM keywords WHERE id=? AND tenant_id=?').bind(row.id, tenantId))
      for (let i = 0; i < statements.length; i += 50) await c.env.DB.batch(statements.slice(i, i + 50))
      cleaned = stale.length
      const beforePageCleanup = await getSeoGeneratedPageStats(c.env, tenantId)
      await cleanupInvalidSeoGeneratedPages(c.env, tenantId, beforePageCleanup)
    }
    if (deleteSitemap) cleanedPages = await deleteSitemapLandingPages(c.env, tenantId)
    if (deleteAiArticles) cleanedArticles = await deletePublishedAiArticles(c.env, tenantId)
    if (deleteLowScore) {
      const rows = (await c.env.DB.prepare("SELECT id FROM articles WHERE ai_generated=1 AND status='published' AND tenant_id = ? AND COALESCE(ai_score,0) < ? ORDER BY id").bind(tenantId, aiScoreThreshold).all()).results as any[]
      const statements: any[] = []
      for (const row of rows) { statements.push(c.env.DB.prepare('DELETE FROM social_posts WHERE article_id=? AND tenant_id=?').bind(row.id, tenantId)); statements.push(c.env.DB.prepare('DELETE FROM review_logs WHERE article_id=? AND tenant_id=?').bind(row.id, tenantId)); statements.push(c.env.DB.prepare('DELETE FROM articles WHERE id=? AND tenant_id=?').bind(row.id, tenantId)) }
      for (let i = 0; i < statements.length; i += 50) await c.env.DB.batch(statements.slice(i, i + 50))
      lowScoreArticles = rows.length
    }
  }
  const after = await getSeoGeneratedPageStats(c.env, getTenantId(c))
  if (cleanupAllGenerated) { const cachePurged = await purgeCacheEverything(c.executionCtx); if (!cachePurged) safeWarn('full production cleanup completed but Worker cache purgeEverything was unavailable or failed') } else await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store'); c.header('Cloudflare-CDN-Cache-Control', 'no-store')
  const qs = new URLSearchParams({ cleaned: String(cleaned), duplicate_cleaned: String(duplicateCleaned), cleaned_pages: String(cleanedPages), cleaned_articles: String(cleanedArticles), low_score_articles: String(lowScoreArticles), all_generated_keywords: String(allGeneratedKeywords), all_generated_articles: String(allGeneratedArticles), all_generated_ai_pages: String(allGeneratedAiPages), ai_score_threshold: String(aiScoreThreshold), remaining: String(after.keywordCleanup), remaining_duplicates: String(after.duplicateKeywords), remaining_pages: String(after.invalidTotal), sitemap_remaining: String(after.sitemapLandings), ai_articles_remaining: String(after.publishedAiArticles) })
  return c.redirect('/admin/keywords?' + qs.toString())
})

function safeWarn(message: string, context?: any): void { console.warn('[admin keywords] ' + message, context || '') }
async function purgeCacheEverything(ctx: any): Promise<boolean> { const { purgeCacheEverything } = await import('../../middleware/cache'); return purgeCacheEverything(ctx) }
function calcOpportunityScore(input: { tier: string; serviceWeight: number; difficulty: string; searchVolume: number }): number { const tierScore = input.tier === '一线' ? 100 : input.tier === '新一线' ? 75 : input.tier === '二线' ? 55 : input.tier === '三线' ? 35 : 50; const difficultyScore = input.difficulty === '高' ? 55 : input.difficulty === '低' ? 10 : 30; const volumeScore = input.searchVolume >= 10000 ? 20 : input.searchVolume >= 1000 ? 15 : input.searchVolume >= 100 ? 10 : input.searchVolume >= 10 ? 5 : 0; return Math.round((tierScore * 0.5 + input.serviceWeight * 0.3 + (100 - difficultyScore) * 0.2) * 0.8 + volumeScore) }
