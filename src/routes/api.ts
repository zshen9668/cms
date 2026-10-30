import { Hono } from 'hono'
import type { Bindings } from '../types'
import { safeError } from '../utils/safeLogger'
import { rateLimit } from '../middleware/security'
import { verifyTurnstile } from '../plugins/turnstile/index'
import { getTenantId } from '../db/scoped'

/**
 * 公开 API 读写端点。
 *
 * - POST /api/messages        前台留言表单提交（限流 + Turnstile 可选 + 蜜罐反垃圾）
 * - GET  /api/health          轻量健康检查（不消耗 Workers AI 额度）
 *
 * 所有写入都带 tenant_id 多租户隔离。
 */
export const apiRoutes = new Hono<{ Bindings: Bindings }>()

// 轻量健康检查：仅 D1 SELECT 1，不触碰 KV/R2/AI，避免消耗免费额度。
apiRoutes.get('/health', async (c) => {
  try {
    if (c.env.DB) {
      await c.env.DB.prepare('SELECT 1').first()
    }
    return c.json({ ok: true, service: 'white-label-cms' })
  } catch (e) {
    safeError('api health check failed', e)
    return c.json({ ok: false, error: 'service unavailable' }, 503)
  }
})

// ---- 前台留言提交（公开，限流）----
apiRoutes.post('/messages', rateLimit(8, 60, 'api-contact'), async (c) => {
  const env = c.env
  const tenantId = getTenantId(c as any)
  const body = await c.req.parseBody()

  // Turnstile:已配置时校验,未配置自动跳过(开发态)
  const ts = await verifyTurnstile(env, getTenantId(c as any), String(body['cf-turnstile-response'] || ''), c.req.header('cf-connecting-ip'))
  if (!ts.valid) return c.json({ ok: false, error: '人机校验失败，请刷新重试' }, 403)

  // 隐藏字段为简单反垃圾蜜罐，正常访客不会填写。
  if (String(body.website || '').trim()) {
    return c.json({ ok: true })
  }

  const safeName = String(body.name || '').trim().slice(0, 100)
  const safePhone = String(body.phone || '').trim().slice(0, 50)
  const safeEmail = String(body.email || '').trim().toLowerCase().slice(0, 254)
  if (safeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
    return c.json({ ok: false, error: '邮箱格式无效' }, 400)
  }
  const safeCity = String(body.city || '').trim().slice(0, 100)
  const safeService = String(body.service || '').trim().slice(0, 100)
  const safeContent = String(body.content || '').trim().slice(0, 2000)
  if (!safePhone) {
    return c.json({ ok: false, error: '手机号必填' }, 400)
  }

  try {
    await env.DB.prepare(
      'INSERT INTO messages (name, phone, email, city, service, content, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(safeName, safePhone, safeEmail, safeCity, safeService, safeContent, tenantId).run()
  } catch (e) {
    safeError('public contact message insert failed', e)
    return c.json({ ok: false, error: '留言暂时提交失败，请稍后再试。' }, 503)
  }

  return c.json({ ok: true })
})

// 未匹配的其他 /api/* 子路径由后续挂载的路由（如 /api/tenants）处理；
// 若全部未匹配，Hono 将返回默认 404。
