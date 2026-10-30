/** 后台「排名追踪」路由：SERP 排位雷达（移植自 seo-main 关键词排位雷达）。
 * 数据层为 rank_tracking / rank_history（migration 0006_seo_rank_track.sql）。 */
import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { getTenantId } from './shared'
import { safeError } from '../../utils/safeLogger'
import { errorMessage } from '../../utils/errors'
import { renderRankingPage, renderRankingFormPage } from '../../templates/admin'
import type { RankTrackRow } from '../../templates/adminRanking'
import { resolveAdminSiteName } from '../../utils/adminSiteName'

export const adminRankingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

function parseRows(results: Array<Record<string, unknown>>): RankTrackRow[] {
  return (results as any[]).map((r) => ({
    id: Number(r.id),
    keywordId: Number(r.keyword_id || 0),
    keyword: String(r.keyword || ''),
    searchEngine: String(r.search_engine || '百度'),
    currentRank: Number(r.current_rank || 0),
    previousRank: Number(r.previous_rank || 0),
    searchVolume: Number(r.search_volume || 0),
    difficulty: String(r.difficulty || '中'),
    intent: String(r.intent || '信息查询'),
    targetUrl: String(r.target_url || ''),
    note: String(r.note || ''),
    lastCheckedAt: String(r.last_checked_at || ''),
  }))
}

/** 从统一关键词矩阵建议一个候选词：当前租户机会分最高且未被跟踪的词。 */
async function suggestKeywordId(db: Bindings['DB'], tenantId: number, keyword: string): Promise<number> {
  const rows = await db.prepare('SELECT id, keyword FROM keywords WHERE tenant_id=? ORDER BY opportunity_score DESC LIMIT 200').bind(tenantId).all()
  const norm = (v: string) => String(v || '').replace(/\s+/g, '').toLocaleLowerCase()
  const input = norm(keyword)
  if (!input) return 0
  for (const row of rows.results as any[]) {
    const kw = norm(String(row.keyword || ''))
    if (kw && (kw === input || kw.includes(input) || input.includes(kw))) return Number(row.id || 0)
  }
  return 0
}

adminRankingRoutes.get('/rankings', async (c) => {
  const tenantId = getTenantId(c)
  const rows = parseRows((await c.env.DB.prepare(
    'SELECT * FROM rank_tracking WHERE tenant_id=? ORDER BY current_rank = 0, current_rank ASC, id DESC LIMIT 300'
  ).bind(tenantId).all()).results as any[])
  const stats = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN current_rank BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3, SUM(CASE WHEN current_rank BETWEEN 1 AND 10 THEN 1 ELSE 0 END) AS top10, SUM(CASE WHEN current_rank = 0 OR current_rank > 100 THEN 1 ELSE 0 END) AS unranked FROM rank_tracking WHERE tenant_id=?"
  ).bind(tenantId).first() as any
  const message = String(c.req.query('message') || '')
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""
  return c.html(renderRankingPage({
    rows,
    total: Number(stats?.total || 0),
    top3: Number(stats?.top3 || 0),
    top10: Number(stats?.top10 || 0),
    unranked: Number(stats?.unranked || 0),
    message,
    siteName, cspNonce, csrfToken,
  }))
})

adminRankingRoutes.post('/rankings', async (c) => {
  const tenantId = getTenantId(c)
  const b = await c.req.parseBody()
  const keyword = String(b.keyword || '').trim().slice(0, 80)
  if (!keyword) return c.redirect('/admin/rankings?message=' + encodeURIComponent('请填写关键词'))
  const suggestion = String(b.keyword_id || '')
  const suggestedId = Number(suggestion === 'suggest' ? await suggestKeywordId(c.env.DB, tenantId, keyword) : suggestion) || 0
  let searchVolume = Math.trunc(Number(b.search_volume || 0)) || 0
  let difficulty = String(b.difficulty || '中')
  const intent = String(b.intent || '信息查询')
  if (suggestedId) {
    const matrixRow = await c.env.DB.prepare('SELECT keyword, search_volume, difficulty FROM keywords WHERE id=? AND tenant_id=?').bind(suggestedId, tenantId).first() as any
    if (matrixRow) {
      searchVolume = Number(matrixRow.search_volume || searchVolume) || 0
      difficulty = String(matrixRow.difficulty || difficulty)
    }
  }
  const currentRank = Math.min(100, Math.max(0, Math.trunc(Number(b.current_rank || 0)) || 0))
  const previousRank = Math.min(100, Math.max(0, Math.trunc(Number(b.previous_rank || 0)) || 0))
  const targetUrl = String(b.target_url || '').trim().slice(0, 500)
  const note = String(b.note || '').trim().slice(0, 200)
  try {
    await c.env.DB.prepare(
      "INSERT INTO rank_tracking (tenant_id, keyword_id, keyword, search_engine, current_rank, previous_rank, search_volume, difficulty, intent, target_url, note, last_checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    ).bind(tenantId, suggestedId || 0, keyword, String(b.search_engine || '百度'), currentRank, previousRank, searchVolume, difficulty, intent, targetUrl, note).run()
    return c.redirect('/admin/rankings?message=' + encodeURIComponent('已开始跟踪：' + keyword + '（' + String(b.search_engine || '百度') + '）'))
  } catch (e) {
    safeError('rank tracking add failed', e)
    return c.redirect('/admin/rankings?message=' + encodeURIComponent(errorMessage(e, '保存失败')) + '；同一关键词+引擎只能跟踪一次，请改走编辑入口。')
  }
})

adminRankingRoutes.get('/rankings/:id/edit', async (c) => {
  const tenantId = getTenantId(c)
  const row = await c.env.DB.prepare('SELECT * FROM rank_tracking WHERE id=? AND tenant_id=?').bind(c.req.param('id'), tenantId).first() as any
  if (!row) return c.notFound()
  const historyRows = await c.env.DB.prepare(
    "SELECT date, rank FROM rank_history WHERE rank_tracking_id=? ORDER BY date DESC, id DESC LIMIT 30"
  ).bind(row.id).all()
  const suggestionKeyword = row.keyword_id
    ? String(((await c.env.DB.prepare('SELECT keyword FROM keywords WHERE id=? AND tenant_id=?').bind(row.keyword_id, tenantId).first() as any)?.keyword || ''))
    : ''
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("csrfToken") || ""
  return c.html(renderRankingFormPage({
    id: Number(row.id),
    keyword: String(row.keyword || ''),
    keywordId: Number(row.keyword_id || 0),
    searchEngine: String(row.search_engine || '百度'),
    currentRank: Number(row.current_rank || 0),
    previousRank: Number(row.previous_rank || 0),
    searchVolume: Number(row.search_volume || 0),
    difficulty: String(row.difficulty || '中'),
    intent: String(row.intent || '信息查询'),
    targetUrl: String(row.target_url || ''),
    note: String(row.note || ''),
    history: (historyRows.results as any[]).map((h) => ({ date: String(h.date || ''), rank: Number(h.rank || 0) })),
    suggestionKeyword,
    error: String(c.req.query('error') || ''),
    siteName,
  }))
})

adminRankingRoutes.post('/rankings/:id/edit', async (c) => {
  const tenantId = getTenantId(c)
  const b = await c.req.parseBody()
  const current = await c.env.DB.prepare('SELECT * FROM rank_tracking WHERE id=? AND tenant_id=?').bind(c.req.param('id'), tenantId).first() as any
  if (!current) return c.notFound()
  const currentRank = Math.min(100, Math.max(0, Math.trunc(Number(b.current_rank || 0)) || 0))
  const previousRank = Math.min(100, Math.max(0, Math.trunc(Number(b.previous_rank || 0)) || 0))
  const today = new Date().toISOString().slice(0, 10)
  try {
    await c.env.DB.prepare(
      "UPDATE rank_tracking SET search_engine=?, current_rank=?, previous_rank=?, search_volume=?, difficulty=?, intent=?, target_url=?, note=?, last_checked_at=datetime('now') WHERE id=? AND tenant_id=?"
    ).bind(
      String(b.search_engine || current.search_engine || '百度'),
      currentRank,
      previousRank,
      Math.trunc(Number(b.search_volume || 0)) || 0,
      String(b.difficulty || current.difficulty || '中'),
      String(b.intent || current.intent || '信息查询'),
      String(b.target_url || '').trim().slice(0, 500),
      String(b.note || '').trim().slice(0, 200),
      current.id,
      tenantId,
    ).run()
    // 每次保存记一条历史快照；同一天的 manual 快照去重，避免历史表膨胀
    const existing = await c.env.DB.prepare("SELECT id FROM rank_history WHERE rank_tracking_id=? AND date=? AND source='manual'").bind(current.id, today).first()
    if (existing) {
      await c.env.DB.prepare('UPDATE rank_history SET rank=? WHERE id=?').bind(currentRank, existing.id).run()
    } else {
      await c.env.DB.prepare('INSERT INTO rank_history (tenant_id, rank_tracking_id, date, rank, source) VALUES (?, ?, ?, ?, \'manual\')').bind(tenantId, current.id, today, currentRank).run()
    }
    return c.redirect('/admin/rankings?message=' + encodeURIComponent('排名已更新：' + String(current.keyword || '') + ' → ' + (currentRank || '未进前100')))
  } catch (e) {
    safeError('rank tracking update failed', e)
    return c.redirect('/admin/rankings/' + current.id + '/edit?error=' + encodeURIComponent(errorMessage(e, '更新失败')))
  }
})

adminRankingRoutes.post('/rankings/:id/delete', async (c) => {
  const tenantId = getTenantId(c)
  const row = await c.env.DB.prepare('SELECT id FROM rank_tracking WHERE id=? AND tenant_id=?').bind(c.req.param('id'), tenantId).first() as any
  if (!row) return c.notFound()
  await c.env.DB.prepare('DELETE FROM rank_history WHERE rank_tracking_id=? AND tenant_id=?').bind(row.id, tenantId).run()
  await c.env.DB.prepare('DELETE FROM rank_tracking WHERE id=? AND tenant_id=?').bind(row.id, tenantId).run()
  return c.redirect('/admin/rankings?message=' + encodeURIComponent('已停止跟踪并删除历史快照。'))
})
