import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { readSettingsMap, saveSetting } from './shared'
import { safeError } from '../../utils/safeLogger'
import { renderNewsSourcesList, renderCollectionLogsList } from '../../templates/admin'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { STYLESHEET_HREF } from '../../templates/assets'
import { runNewsCollection } from '../../cron/newsCollector'
import { analyzeNewsSource, publishAnalyzedNewsCandidate } from '../../cron/newsCollector'
import { getAiSettings } from '../../utils/aiSettings'
import { errorMessage } from '../../utils/errors'
import { escapeHtml } from '../../utils/html'
import { getNewsQualityThreshold, getNewsRoundItemsLimit } from '../../services/newsPipeline'
import { purgeCacheAll } from '../../middleware/cache'
import { getTenantId } from '../../db/scoped'

export const adminNewsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ---- 采集任务运行日志 ----
adminNewsRoutes.get('/collection-logs', async (c) => {
  const tenantId = getTenantId(c)
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""
  const rows = (await c.env.DB.prepare('SELECT * FROM collection_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100').bind(tenantId).all()).results
  const message = c.req.query('deleted') === 'all' ? '已一键删除全部采集日志。' : ''
  return c.html(renderCollectionLogsList(rows as any, message, siteName, cspNonce, csrfToken))
})

adminNewsRoutes.post('/collection-logs/delete-all', async (c) => {
  try {
    await c.env.DB.prepare('DELETE FROM collection_logs WHERE tenant_id=?').bind(getTenantId(c)).run()
  } catch (e) {
    safeError('delete all collection logs failed', e)
    return c.text('删除全部采集日志失败', 500)
  }
  return c.redirect('/admin/collection-logs?deleted=all')
})

adminNewsRoutes.post('/collection-logs/:id/delete', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  try {
    await c.env.DB.prepare('DELETE FROM collection_logs WHERE id=? AND tenant_id=?').bind(id, getTenantId(c)).run()
  } catch (e) {
    safeError('delete collection log failed', e)
    return c.text('删除采集日志失败', 500)
  }
  return c.redirect('/admin/collection-logs')
})

// ---- 新闻采集源 ----

adminNewsRoutes.get('/news-sources', async (c) => {
  const tenantId = getTenantId(c)
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""
  const rows = (await c.env.DB.prepare('SELECT * FROM news_sources WHERE tenant_id = ? ORDER BY id DESC').bind(tenantId).all()).results
  const collectedArticles = (await c.env.DB.prepare("SELECT id, title, slug, source_name, source_url, status, created_at FROM articles WHERE ai_generated=1 AND tenant_id = ? ORDER BY created_at DESC LIMIT 200").bind(tenantId).all()).results
  const settings = await readSettingsMap(c.env, getTenantId(c))
  const schedule = { enabled: settings['news_collection_enabled'] === '1', time: /^\d{2}:[0-5]\d$/.test(settings['news_collection_time'] || '') ? settings['news_collection_time']! : '08:00' }
  const message = c.req.query('error') || (c.req.query('started') === '1' ? '采集任务已在后台启动。请稍后查看“采集日志”确认抓取、AI解读和自动发布结果。' : '') || (c.req.query('collected') === '1' ? '新闻采集完成：AI通过质量门槛后统一进入待审核；失败或低质量内容不会发布。' : '') || (c.req.query('schedule_saved') === '1' ? '定时采集时间已保存。' : '') || (c.req.query('quality_saved') === '1' ? 'AI 内容质量门槛已保存，下一轮采集立即生效。' : '') || (c.req.query('round_saved') === '1' ? '每轮采集条数已保存，下一轮采集立即生效。' : '') || (c.req.query('auto_publish_saved') === '1' ? '自动发布设置已保存。' : '')
  const qualityMin = getNewsQualityThreshold(settings)
  const roundItems = getNewsRoundItemsLimit(settings)
  const autoPublish = settings.news_auto_publish === '1'
  return c.html(renderNewsSourcesList(rows as any, collectedArticles as any, message, schedule, qualityMin, roundItems, autoPublish, siteName, cspNonce, csrfToken))
})

adminNewsRoutes.post('/news-sources/collect', async (c) => {
  const tenantId = getTenantId(c)
  c.executionCtx.waitUntil(runNewsCollection(c.env, tenantId).catch((e) => safeError('manual news collection failed', e)))
  return c.redirect('/admin/news-sources?started=1')
})

adminNewsRoutes.post('/news-sources/new', async (c) => {
  const b = await c.req.parseBody()
  const tenantId = getTenantId(c)
  const name = String(b.name || '').trim().slice(0, 120)
  const feedUrl = String(b.feed_url || '').trim()
  const credibility = String(b.credibility || '中').trim()
  if (!name) return c.text('请填写来源名称', 400)
  let parsedUrl: URL
  try {
    parsedUrl = new URL(feedUrl)
  } catch {
    return c.text('来源地址必须是完整的 http:// 或 https:// 地址', 400)
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    return c.text('来源地址必须使用 http:// 或 https://', 400)
  }
  if (!['高', '中', '低'].includes(credibility)) {
    return c.text('可信度只能填写 高 / 中 / 低', 400)
  }
  const exists = await c.env.DB.prepare('SELECT id FROM news_sources WHERE feed_url=? AND tenant_id=? LIMIT 1')
    .bind(parsedUrl.href, tenantId).first()
  if (exists) return c.text('这个来源地址已经添加过，请直接使用现有来源或换一个列表页地址', 409)
  try {
    await c.env.DB.prepare('INSERT INTO news_sources (name, feed_url, credibility, tenant_id) VALUES (?, ?, ?, ?)')
      .bind(name, parsedUrl.href, credibility, tenantId).run()
  } catch (e) {
    safeError('create news source failed', e)
    return c.text(errorMessage(e, '添加新闻来源失败'), 500)
  }
  return c.redirect('/admin/news-sources')
})

adminNewsRoutes.post('/news-sources/:id/delete', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  await c.env.DB.prepare('DELETE FROM news_sources WHERE id=? AND tenant_id=?').bind(id, getTenantId(c)).run()
  return c.redirect('/admin/news-sources')
})

adminNewsRoutes.post('/news-sources/:id/collect', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  const tenantId = getTenantId(c)
  const source = await c.env.DB.prepare('SELECT id FROM news_sources WHERE id=? AND tenant_id=?').bind(id, tenantId).first()
  if (!source) return c.notFound()
  c.executionCtx.waitUntil(runNewsCollection(c.env, id).catch((e) => safeError('single news source collection failed', e)))
  return c.redirect('/admin/news-sources?started=1')
})

adminNewsRoutes.post('/news-sources/:id/analyze', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  const tenantId = getTenantId(c)
  const source = await c.env.DB.prepare('SELECT id, name, feed_url FROM news_sources WHERE id=? AND tenant_id=? LIMIT 1').bind(id, tenantId).first() as any
  if (!source) return c.notFound()
  const aiSettings = await getAiSettings(c.env, getTenantId(c))
  if (!aiSettings.enabled) return c.redirect('/admin/news-sources/' + id + '/edit?error=' + encodeURIComponent('AI 功能当前已停用，请先在 AI 设置中启用。'))
  c.executionCtx.waitUntil((async () => {
    try {
      const result = await analyzeNewsSource(c.env, getTenantId(c), String(source.feed_url || ''), String(source.name || ''), aiSettings)
      await saveSetting(c.env, 'news_source_analysis:' + String(id), JSON.stringify({
        status: result.analysis ? 'ok' : 'no-candidates',
        sourceUrl: String(source.feed_url || ''),
        method: result.analysis?.method || 'ai-source-page',
        summary: result.analysis?.summary || 'AI 已分析来源页面，但没有识别到可核验的新闻候选。',
        items: result.analysis?.items || [],
        updatedAt: new Date().toISOString(),
      }), getTenantId(c))
    } catch (e) {
      safeError('manual AI source analysis failed', e, { feedUrl: source.feed_url })
      await saveSetting(c.env, 'news_source_analysis:' + String(id), JSON.stringify({
        status: 'error',
        sourceUrl: String(source.feed_url || ''),
        summary: errorMessage(e, '来源分析失败').slice(0, 1200),
        items: [],
        updatedAt: new Date().toISOString(),
      }), getTenantId(c))
    }
  })())
  return c.redirect('/admin/news-sources/' + id + '/edit?analyzing=1')
})

adminNewsRoutes.post('/news-sources/:id/analyze-publish', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  const tenantId = getTenantId(c)
  const source = await c.env.DB.prepare('SELECT id, name, feed_url FROM news_sources WHERE id=? AND tenant_id=? LIMIT 1').bind(id, tenantId).first() as any
  if (!source) return c.notFound()
  const form = await c.req.parseBody()
  const candidateIndex = Number(form.candidate_index)
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0) return c.redirect('/admin/news-sources/' + id + '/edit?error=' + encodeURIComponent('没有选择有效的 AI 候选'))
  const analysisRow = await c.env.DB.prepare('SELECT value FROM settings WHERE key=?').bind('news_source_analysis:' + String(id)).first() as any
  let analysis: any = null; try { analysis = analysisRow?.value ? JSON.parse(String(analysisRow.value)) : null } catch {}
  const candidates = Array.isArray(analysis?.items) ? analysis.items : []
  const candidate = candidates[candidateIndex]
  if (!candidate?.title || !candidate?.link) return c.redirect('/admin/news-sources/' + id + '/edit?error=' + encodeURIComponent('该 AI 候选已不存在，请先重新分析来源地址 / 列表页'))
  const aiSettings2 = await getAiSettings(c.env, getTenantId(c))
  if (!aiSettings2.enabled) return c.redirect('/admin/news-sources/' + id + '/edit?error=' + encodeURIComponent('AI 功能当前已停用，请先在 AI 设置中启用'))
  c.executionCtx.waitUntil(publishAnalyzedNewsCandidate(c.env, getTenantId(c), id, {
    title: String(candidate.title || ''),
    link: String(candidate.link || ''),
    evidence: String(candidate.evidence || ''),
    confidence: Number(candidate.confidence || 0),
  }).catch(async (e) => {
    const errorText = errorMessage(e, '发布失败').slice(0, 1200)
    safeError('publish analyzed news candidate failed', undefined, { sourceId: id, candidateIndex, error: errorText })
    try {
      await c.env.DB.prepare('INSERT INTO collection_logs (source_name, fetched_count, created_count, published_count, error, tenant_id) VALUES (?, 1, 0, 0, ?, ?)').bind(String(source.name || '新闻来源'), '候选 AI 解读发布异常：' + errorText, getTenantId(c)).run()
    } catch (logError) {
      safeError('write candidate publish failure log failed', logError)
    }
    try {
      await saveSetting(c.env, 'news_source_analysis_publish_error:' + String(id), JSON.stringify({
        candidateIndex,
        title: String(candidate.title || ''),
        link: String(candidate.link || ''),
        error: errorMessage(e, '发布失败').slice(0, 1200),
        updatedAt: new Date().toISOString(),
      }), getTenantId(c))
    } catch {}
  }))
  return c.redirect('/admin/news-sources/' + id + '/edit?publishing=1')
})

adminNewsRoutes.post('/news-sources/auto-publish', async (c) => {
  const b = await c.req.parseBody()
  const enabled = b.news_auto_publish === 'on'
  await saveSetting(c.env, 'news_auto_publish', enabled ? '1' : '0', getTenantId(c))
  return c.redirect('/admin/news-sources?auto_publish_saved=1')
})

adminNewsRoutes.post('/news-sources/schedule', async (c) => {
  const b = await c.req.parseBody()
  const enabled = b.enabled ? '1' : '0'
  const time = String(b.collection_time || '').trim()
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return c.redirect('/admin/news-sources?error=' + encodeURIComponent('定时任务时间格式不正确'))
  const minute = Number(time.slice(3, 5))
  if (minute % 5 !== 0) return c.redirect('/admin/news-sources?error=' + encodeURIComponent('定时任务目前按 5 分钟一个时间点设置，例如 08:00、08:05、18:30'))
  await saveSetting(c.env, 'news_collection_enabled', enabled, getTenantId(c))
  await saveSetting(c.env, 'news_collection_time', time, getTenantId(c))
  return c.redirect('/admin/news-sources?schedule_saved=1')
})

adminNewsRoutes.post('/news-sources/quality', async (c) => {
  const b = await c.req.parseBody()
  const raw = String(b.news_quality_min || '').trim()
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 100) return c.redirect('/admin/news-sources?error=' + encodeURIComponent('质量门槛必须是 0-100 的整数'))
  await saveSetting(c.env, 'news_quality_min', String(Math.round(value)), getTenantId(c))
  return c.redirect('/admin/news-sources?quality_saved=1')
})

adminNewsRoutes.post('/news-sources/round-items', async (c) => {
  const b = await c.req.parseBody()
  const raw = String(b.news_round_items || '').trim()
  const value = Math.trunc(Number(raw))
  if (!Number.isFinite(value) || value < 1 || value > 5) return c.redirect('/admin/news-sources?error=' + encodeURIComponent('每轮条数必须是 1-5 的整数（默认 1）'))
  await saveSetting(c.env, 'news_round_items', String(value), getTenantId(c))
  return c.redirect('/admin/news-sources?round_saved=1')
})

adminNewsRoutes.post('/news-sources/articles/:id/recreate', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  const recreateTenantId = getTenantId(c)
  const article = await c.env.DB.prepare('SELECT * FROM articles WHERE id=? AND ai_generated=1 AND tenant_id=?').bind(id, recreateTenantId).first() as any
  if (!article) return c.notFound()
  const slug = 'news-copy-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  try { const created = await c.env.DB.prepare(`INSERT INTO articles (title, slug, category, summary, content, source_url, source_name, ai_generated, credibility_score, status, published_at, seo_title, seo_keywords, seo_description, card_svg, ai_score, slides_json, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'draft', NULL, ?, ?, ?, ?, ?, ?, ?)`).bind(String(article.title || '').trim(), slug, String(article.category || '政策解读'), String(article.summary || '').trim(), String(article.content || '').trim() || '<p>请补充文章正文。</p>', String(article.source_url || ''), String(article.source_name || ''), Number(article.credibility_score || 70), String(article.seo_title || '').trim(), String(article.seo_keywords || '').trim(), String(article.seo_description || '').trim(), article.card_svg || null, Number(article.ai_score || 60), article.slides_json || '[]', recreateTenantId).first() as any; await c.env.DB.prepare('INSERT INTO review_logs (article_id, action, operator, note) VALUES (?, ?, ?, ?)').bind(created.id, 'copy_for_edit', 'admin', '已采集文章重新提交创建为新的草稿').run(); c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx)); return c.redirect('/admin/news-sources?collected=1') } catch (e) { safeError('recreate collected article failed', e); return c.redirect('/admin/news-sources?error=' + encodeURIComponent(errorMessage(e, '重新创建文章失败'))) }
})

adminNewsRoutes.get('/news-sources/:id/edit', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  const source = await c.env.DB.prepare('SELECT * FROM news_sources WHERE id=? AND tenant_id=? LIMIT 1').bind(id, getTenantId(c)).first() as any
  if (!source) return c.notFound()
  const analysisRow = await c.env.DB.prepare('SELECT value FROM settings WHERE key=?').bind('news_source_analysis:' + String(id)).first() as any
  let sourceAnalysis: any = null; try { sourceAnalysis = analysisRow?.value ? JSON.parse(String(analysisRow.value)) : null } catch {}
  const analysisItems = Array.isArray(sourceAnalysis?.items) ? sourceAnalysis.items : []
  const analysisStatus = String(sourceAnalysis?.status || '')
  const analysisBadge = analysisStatus === 'ok' ? '<span class="badge" style="background:#e7f7ee;color:#1a8a4e">AI分析完成</span>' : analysisStatus === 'error' ? '<span class="badge" style="background:#fdeaea;color:#e5484d">AI分析失败</span>' : analysisStatus === 'no-candidates' ? '<span class="badge" style="background:#fff7e6;color:#ad6800">未识别候选</span>' : ''
  const analysisHtml = sourceAnalysis ? `<div class="card" style="margin-top:16px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">AI来源地址 / 列表页分析</h3>${analysisBadge}</div><p style="color:var(--muted);font-size:13px;line-height:1.8;margin:8px 0">${escapeHtml(String(sourceAnalysis.summary || ''))}${sourceAnalysis.updatedAt ? '<br>分析时间：' + escapeHtml(String(sourceAnalysis.updatedAt)) : ''}</p>${analysisItems.length ? `<table style="margin-top:10px"><thead><tr><th>候选标题</th><th>链接</th><th>证据摘录</th><th>置信度</th><th>操作</th></tr></thead><tbody>${analysisItems.map((item: any, i: number) => `<tr><td>${escapeHtml(String(item?.title || ''))}</td><td style="max-width:280px;word-break:break-all"><a href="${escapeHtml(String(item?.link || ''))}" target="_blank" rel="nofollow noopener">${escapeHtml(String(item?.link || ''))}</a></td><td>${escapeHtml(String(item?.evidence || '')).slice(0, 200)}</td><td>${String(item?.confidence || '')}</td><td><form method="post" action="/admin/news-sources/${id}/analyze-publish" style="margin:0;display:inline"><input type="hidden" name="candidate_index" value="${i}" /><button type="submit" class="btn" onclick="return confirm('确定发布此候选？发布后将进入待审核，不会直接公开。')">发布</button></form></td></tr>`).join('')}</tbody></table>` : ''}</div>` : ''
  return c.html(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>编辑采集源</title><link rel="stylesheet" href="${STYLESHEET_HREF}" /></head><body class="auth-page"><h2>编辑采集源：${escapeHtml(String(source.name || ''))}</h2><form method="post" action="/admin/news-sources/${id}/edit"><input name="name" value="${escapeHtml(String(source.name || ''))}" placeholder="来源名称" /><input name="feed_url" value="${escapeHtml(String(source.feed_url || ''))}" placeholder="RSS/列表页地址" /><select name="credibility"><option>高</option><option>中</option><option>低</option></select><label><input name="is_active" type="checkbox" ${source.is_active ? 'checked' : ''}> 启用</label><button type="submit">保存</button></form><a href="/admin/news-sources/${id}/delete" onclick="return confirm('确认删除？')" style="color:#e5484d">删除采集源</a><br><a href="/admin/news-sources">返回列表</a>${analysisHtml}</body></html>`)
})

adminNewsRoutes.post('/news-sources/:id/edit', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  const tenantId = getTenantId(c)
  const source = await c.env.DB.prepare('SELECT id FROM news_sources WHERE id=? AND tenant_id=? LIMIT 1').bind(id, tenantId).first() as any
  if (!source) return c.notFound()
  const b = await c.req.parseBody()
  const name = String(b.name || '').trim().slice(0, 120)
  const feedUrl = String(b.feed_url || '').trim()
  const credibility = String(b.credibility || '中').trim()
  const isActive = b.is_active ? 1 : 0
  if (!name) return c.text('请填写来源名称', 400)
  let parsedUrl: URL
  try { parsedUrl = new URL(feedUrl) } catch { return c.text('来源地址必须是完整的 http:// 或 https:// 地址', 400) }
  if (!/^https?:$/.test(parsedUrl.protocol)) { return c.text('来源地址必须使用 http:// 或 https://', 400) }
  if (!['高', '中', '低'].includes(credibility)) { return c.text('可信度只能填写 高 / 中 / 低', 400) }
  await c.env.DB.prepare('UPDATE news_sources SET name=?, feed_url=?, credibility=?, is_active=? WHERE id=? AND tenant_id=?').bind(name, parsedUrl.href, credibility, isActive, id, tenantId).run()
  return c.redirect('/admin/news-sources/' + id + '/edit?saved=1')
})
