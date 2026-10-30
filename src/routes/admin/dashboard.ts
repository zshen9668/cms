import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { getTenantId } from './shared'
import { safeError } from '../../utils/safeLogger'
import { renderDashboard } from '../../templates/admin'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { getRecentViewTrend } from '../../utils/stats'

export const adminDashboardRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/** 多久没更新算「陈旧」。AI 引擎与搜索引擎都偏好近期更新过的页面。 */
const STALE_CONTENT_DAYS = 365

adminDashboardRoutes.get('/', async (c) => {
  const env = c.env
  const tenantId = getTenantId(c)
  const [summary, trend, topKeywords] = await Promise.all([
    env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM articles WHERE tenant_id = ?) AS articles,
        (SELECT COUNT(*) FROM articles WHERE tenant_id = ? AND created_at >= date('now') AND created_at < date('now','+1 day')) AS today,
        (SELECT COUNT(*) FROM articles WHERE tenant_id = ? AND status='pending_review') AS pending,
        (SELECT COUNT(*) FROM keywords WHERE tenant_id = ?) AS keywords,
        COALESCE((SELECT views FROM daily_stats WHERE date = date('now')), 0) AS today_views`
    ).bind(tenantId, tenantId, tenantId, tenantId).first(),
    getRecentViewTrend(env, 7),
    env.DB.prepare(
      `SELECT k.keyword, k.opportunity_score, ci.name as city_name, s.name as service_name
       FROM keywords k LEFT JOIN cities ci ON ci.id = k.city_id LEFT JOIN services s ON s.id = k.service_id
       WHERE k.tenant_id = ? ORDER BY k.opportunity_score DESC LIMIT 5`
    ).bind(tenantId).all().then((r) => r.results as any[]),
  ])
  const s = summary as any
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  // 内容新鲜度与 GEO 完整性。
  // 单独 try/catch：即使库是旧结构（articles 缺少 faq_json / updated_at 等列），
  // 也只是这一块不显示，不能让整个仪表盘 500。
  let contentHealth = {
    publishedTotal: 0,
    staleDays: STALE_CONTENT_DAYS,
    staleTotal: 0,
    missingFaq: 0,
    missingCover: 0,
    missingDescription: 0,
    staleList: [] as Array<{ id: number; title: string; slug: string; lastUpdated: string; ageDays: number }>,
  }
  try {
    const totals = await env.DB.prepare(
      `SELECT
         COUNT(*) AS published_total,
         SUM(CASE WHEN COALESCE(faq_json,'') = '' THEN 1 ELSE 0 END) AS missing_faq,
         SUM(CASE WHEN COALESCE(cover_image,'') = '' THEN 1 ELSE 0 END) AS missing_cover,
         SUM(CASE WHEN COALESCE(seo_description,'') = '' THEN 1 ELSE 0 END) AS missing_description,
         SUM(CASE WHEN julianday('now') - julianday(COALESCE(updated_at, published_at, created_at)) > ? THEN 1 ELSE 0 END) AS stale_total
       FROM articles WHERE status='published' AND tenant_id = ?`
    ).bind(STALE_CONTENT_DAYS, tenantId).first() as any

    const staleRows = await env.DB.prepare(
      `SELECT id, title, slug,
              COALESCE(updated_at, published_at, created_at) AS last_updated,
              CAST(julianday('now') - julianday(COALESCE(updated_at, published_at, created_at)) AS INTEGER) AS age_days
       FROM articles
       WHERE status='published' AND tenant_id = ?
         AND julianday('now') - julianday(COALESCE(updated_at, published_at, created_at)) > ?
       ORDER BY age_days DESC LIMIT 10`
    ).bind(tenantId, STALE_CONTENT_DAYS).all()

    contentHealth = {
      publishedTotal: Number(totals?.published_total || 0),
      staleDays: STALE_CONTENT_DAYS,
      staleTotal: Number(totals?.stale_total || 0),
      missingFaq: Number(totals?.missing_faq || 0),
      missingCover: Number(totals?.missing_cover || 0),
      missingDescription: Number(totals?.missing_description || 0),
      staleList: (staleRows.results as any[]).map((row) => ({
        id: Number(row.id),
        title: String(row.title || ''),
        slug: String(row.slug || ''),
        lastUpdated: String(row.last_updated || ''),
        ageDays: Number(row.age_days || 0),
      })),
    }
  } catch (e) {
    safeError('dashboard content health read failed', e)
  }

  return c.html(renderDashboard({
    articles: Number(s?.articles || 0),
    today: Number(s?.today || 0),
    pending: Number(s?.pending || 0),
    keywords: Number(s?.keywords || 0),
    todayViews: Number(s?.today_views || 0),
    trend,
    topKeywords,
    contentHealth,
  }, siteName, cspNonce, csrfToken))
})
