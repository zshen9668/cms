import { Hono } from 'hono'
import type { Bindings } from '../../types'
import { getLanguageAdmin, updateLanguageAdmin } from '../../modules/adminManagers/languageAdmin'
import { purgeCacheAll } from '../../middleware/cache'

export const languageAdminRoutes = new Hono<{ Bindings: Bindings }>()

languageAdminRoutes.get('/', async (c) => {
  const data = await getLanguageAdmin(c.env)
  return c.json({ ok: true, data })
})

languageAdminRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  await updateLanguageAdmin(c.env, body)
  // 语言启停/默认语言变更后，前台语言切换器与 hreflang 会整体变化。
  // 立即清掉 CDN 侧旧 HTML 缓存（languageManager 内置 30s 内存 TTL 也会自动过期），
  // 否则站长改完设置要等 30s 才在后台看到语言切换生效。
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.json({ ok: true })
})
