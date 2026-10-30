import { Hono } from 'hono'
import type { CmsPlugin } from '../types'
import type { Bindings, Variables } from '../../types'
import { safeError } from '../../utils/safeLogger'
import { getTenantId } from '../../db/scoped'
import { resolveAdminSiteName } from '../../utils/adminSiteName'

/**
 * 分析统计插件(移植 SonicJS analytics 插件,适配 cms 现有 daily_stats 表)。
 * - 公开端 GET /api/stats/daily:近 30 天每日 PV(daily_stats 已有数据由现有统计逻辑写入)
 * - 管理端 GET /admin/analytics:HTML 看板(表格,无前端框架依赖)
 * 不做 UV/匿名指纹(属阶段 3 扩展),保持零新增表。
 */
const routes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

async function getDailyStats(env: Bindings, days = 30) {
  const { results } = await env.DB.prepare(
    `SELECT date, views FROM daily_stats
     WHERE date >= date('now', ?)
     ORDER BY date ASC`,
  ).bind(`-${Math.max(1, Math.min(365, days))} days`).all()
  return (results || []) as Array<{ date: string; views: number | null }>
}

routes.get('/admin/analytics', async (c) => {
  try {
    const rows = await getDailyStats(c.env)
    const total = rows.reduce((sum, r) => sum + Number(r.views || 0), 0)
    const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
    const activeTab = c.req.query('tab') || 'daily'
    const cspNonce = (c as any).get('cspNonce') || ''
    const tabs = [
      { key: 'daily', label: '按日统计', href: '/admin/analytics?tab=daily' },
      { key: 'overview', label: '概览', href: '/admin/analytics?tab=overview' },
    ]
    const tabBar = tabs.map((t) =>
      `<a class="btn ${activeTab === t.key ? '' : 'secondary'}" href="${t.href}">${t.label}</a>`
    ).join('')

    if (activeTab === 'overview') {
      const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>分析统计</title>
<style>body{font-family:system-ui;padding:24px;max-width:720px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:13px}a{color:#111}</style></head>
<body>
<h2>分析统计概览</h2>
<p>合计 PV:<strong>${total}</strong>　<a href="/admin">← 返回后台</a></p>
<div style="margin-bottom:16px">${tabBar}</div>
<table><thead><tr><th>日期</th><th>PV</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${r.date}</td><td>${Number(r.views || 0)}</td></tr>`).join('')}
</tbody></table>
</body></html>`
      return c.html(html)
    }

    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>分析统计</title>
<style>body{font-family:system-ui;padding:24px;max-width:720px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:13px}a{color:#111}</style></head>
<body>
<h2>近 ${rows.length} 天按日统计</h2>
<p>合计 PV:<strong>${total}</strong>　<a href="/admin">← 返回后台</a></p>
<div style="margin-bottom:16px">${tabBar}</div>
<table><thead><tr><th>日期</th><th>PV</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${r.date}</td><td>${Number(r.views || 0)}</td></tr>`).join('')}
</tbody></table>
</body></html>`
    return c.html(html)
  } catch (e) {
    safeError('analytics admin page failed', e)
    return c.html('<p>统计加载失败</p>', 500)
  }
})

const publicRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

publicRoutes.get('/api/stats/daily', async (c) => {
  try {
    const rows = await getDailyStats(c.env, 30)
    return c.json({ ok: true, days: rows.length, total: rows.reduce((s, r) => s + Number(r.views || 0), 0), series: rows })
  } catch (e) {
    safeError('public stats endpoint failed', e)
    return c.json({ ok: false, error: '统计不可用' }, 503)
  }
})

export const analyticsPlugin: CmsPlugin = {
  id: 'analytics',
  version: '1.0.0',
  mount(app) {
    app.route('/', routes)
    app.route('/', publicRoutes)
  },
}
