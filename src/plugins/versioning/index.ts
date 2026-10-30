import { Hono } from 'hono'
import type { CmsPlugin } from '../types'
import type { Bindings, Variables } from '../../types'
import { safeError, safeWarn } from '../../utils/safeLogger'
import { listVersions, restoreVersion, captureVersion } from './service'
import { renderVersionPanel } from '../../templates/adminArticleVersions'
/**
 * 版本历史插件(移植 SonicJS versioning-plugin 的快照/回滚模式)。
 * - 管理端路由:/admin/articles/:id/versions(HTML 面板 + JSON)
 * - 快照写入:captureVersion(env, articleId, actorId) 由文章编辑保存路径调用
 * - 回滚:POST /admin/articles/:id/versions/:version/restore
 */
const routes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

routes.get('/articles/:id/versions', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.notFound()
    const tenantId = c.get('tenant')?.id ?? 1
    const versions = await listVersions(c.env, tenantId, id)
    const asJson = c.req.query('format') === 'json'
    if (asJson) return c.json({ ok: true, versions })
    return c.html(renderVersionPanel(id, versions))
  } catch (e) {
    safeError('list article versions failed', e)
    return c.redirect('/admin/articles?error=' + encodeURIComponent('版本列表加载失败'))
  }
})

routes.post('/articles/:id/versions/:version/restore', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    const version = Number(c.req.param('version'))
    if (!Number.isFinite(id) || !Number.isInteger(version) || version < 1) {
      return c.redirect('/admin/articles?error=' + encodeURIComponent('无效的版本号'))
    }
    const tenantId = c.get('tenant')?.id ?? 1
    // 操作者身份:requireAdmin 已把当前管理员 uid 注入 c.set('adminUid');读不到时回退 1
    const actor = Number(c.get('adminUid')) || 1
    await restoreVersion(c.env, tenantId, id, version)
    await captureVersion(c.env, tenantId, id, actor, 'restore')
    return c.redirect('/admin/articles?ok=' + encodeURIComponent('已回滚到版本 ' + version))
  } catch (e: any) {
    safeError('restore article version failed', e)
    return c.redirect('/admin/articles?error=' + encodeURIComponent(String(e?.message || e || '回滚失败')))
  }
})

export const versioningPlugin: CmsPlugin = {
  id: 'versioning',
  version: '1.0.0',
  mount(app) {
    // 挂在 /admin 命名空间下;admin.ts 已对 requireAdmin 全局拦截
    app.route('/admin', routes)
  },
  onScheduled: publishScheduledArticles,
}

/**
 * 调度发布:到点的 scheduled 文章批量切 published(5 分钟 cron tick 驱动)。
 * 移植 SonicJS versioning-plugin 的 schedule 能力;KV 锁防重执行。
 */
async function publishScheduledArticles(env: Bindings, _ctx: ExecutionContext) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const due = (await env.DB.prepare(
    "SELECT id, title, tenant_id FROM articles WHERE status = 'scheduled' AND published_at IS NOT NULL AND published_at <= ?",
  ).bind(now).all()).results as any[]
  if (!due.length) return

  let changed = 0
  for (const a of due) {
    try {
      const result = await env.DB.prepare(
        "UPDATE articles SET status = 'published', reviewed_by = 'cron', reviewed_at = datetime('now') WHERE id = ? AND tenant_id = ? AND status = 'scheduled'",
      ).bind(a.id, a.tenant_id || 1).run()
      if (Number((result as any)?.meta?.changes || 0) > 0) {
        await captureVersion(env, a.tenant_id || 1, Number(a.id), 1, 'auto_publish')
        changed++
      }
    } catch {
      // 单条失败不阻塞其余
    }
  }
  if (changed > 0) {
    safeWarn('scheduled publish: ' + changed + ' article(s) published by cron')
  }
}

export { captureVersion }
