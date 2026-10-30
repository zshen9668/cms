import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'
import { safeError } from '../utils/safeLogger'
import { rateLimit } from '../middleware/security'
import { getTenantId } from '../db/scoped'
import { requireApiKey } from '../plugins/apiKeys/index'

/**
 * 公开 API 读端点(移植 SonicJS api 只读面 + Bearer 鉴权)。
 * - 需 `Authorization: Bearer <sk_cms_...>`(apiKeys 插件签发的密钥,read scope)
 * - GET /api/v2/articles      已发布文章列表
 * - GET /api/v2/articles/:id  单篇
 * - GET /api/v2/cities        城市列表
 * 数据只读、限流;多租户数据按当前路径租户过滤(公开端默认租户 1)。
 */
export const apiV2Routes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// 统一 Bearer 鉴权:所有 /api/v2 子路由都过这层
apiV2Routes.use('*', async (c, next) => {
  const auth = await requireApiKey(c, 'read', getTenantId(c))
  if (!auth.ok) return c.json({ ok: false, error: '无效或缺少 API 密钥(read scope 的 Bearer token)' }, 401)
  c.set('apiKeyId', auth.keyId)
  c.set('apiKeyScope', auth.scope)
  await next()
})

// 读限流(每租户/密钥 30 次/分钟):套在鉴权之后
apiV2Routes.use('/articles*', rateLimit(30, 60, 'api-v2'))
apiV2Routes.use('/cities', rateLimit(30, 60, 'api-v2'))

apiV2Routes.get('/articles', async (c) => {
  try {
    const tenantId = getTenantId(c)
    const { results } = await c.env.DB.prepare(
      "SELECT id, slug, title, summary, status, published_at FROM articles WHERE status='published' AND tenant_id=? ORDER BY published_at DESC, id DESC LIMIT 100",
    ).bind(tenantId).all()
    return c.json({ ok: true, count: (results as any[] | undefined)?.length || 0, articles: results })
  } catch (e) {
    safeError('api/v2 articles list failed', e)
    return c.json({ ok: false, error: '服务不可用' }, 503)
  }
})

apiV2Routes.get('/articles/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    const tenantId = getTenantId(c)
    const row = await c.env.DB.prepare(
      "SELECT id, slug, title, category, summary, content, status, seo_title, seo_description, seo_keywords, published_at FROM articles WHERE id=? AND tenant_id=? AND status='published'",
    ).bind(id, tenantId).first() as any
    if (!row) return c.json({ ok: false, error: '文章不存在或未发布' }, 404)
    return c.json({ ok: true, article: row })
  } catch (e) {
    safeError('api/v2 article get failed', e)
    return c.json({ ok: false, error: '服务不可用' }, 503)
  }
})

apiV2Routes.get('/cities', async (c) => {
  try {
    const tenantId = getTenantId(c)
    const { results } = await c.env.DB.prepare(
      "SELECT id, slug, name, province, is_active FROM cities WHERE tenant_id=? AND is_active=1 ORDER BY name LIMIT 500",
    ).bind(tenantId).all()
    return c.json({ ok: true, count: (results as any[] | undefined)?.length || 0, cities: results })
  } catch (e) {
    safeError('api/v2 cities list failed', e)
    return c.json({ ok: false, error: '服务不可用' }, 503)
  }
})
