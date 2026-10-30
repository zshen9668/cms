import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'
import { rateLimit } from '../middleware/security'
import { hashPassword, verifyPassword } from '../utils/password'
import { safeError } from '../utils/safeLogger'

/**
 * SaaS 租户/用户 API（挂载在 /api/saas）。
 * - POST /api/saas/tenants             创建租户 + owner 用户 + 成员关系（已限流）
 * - POST /api/saas/tenants/:slug/login 用户邮箱+密码登录 → 返回 KV 会话 token(明文 UUID)（已限流）
 * - GET  /api/saas/auth/me              Bearer token 解析 → 当前租户 + tier；无 token 一律 401
 *
 * 会话模型:登录时生成 UUID 存 CACHE_KV(saas_session:<uuid> → {userId, tenantId, exp}),
 * 客户端在后续请求 Authorization: Bearer <uuid> 出示。
 * 与后台 admin 的 JWT cookie 体系完全独立:后台管理员 = admin_users;SaaS 用户 = users 表。
 */
export const tenantRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 天

tenantRoutes.post('/tenants', rateLimit(5, 60, 'saas-register'), async (c) => {
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const slug = String(b.slug || '').trim().toLowerCase()
  const ownerEmail = String(b.owner_email || '').trim()
  const password = String(b.password || '')

  if (!SLUG_RE.test(slug)) return c.json({ ok: false, error: 'slug 需 2-31 位小写字母/数字/连字符' }, 400)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) return c.json({ ok: false, error: 'owner_email 格式无效' }, 400)
  if (password.length < 10) return c.json({ ok: false, error: 'password 至少 10 位' }, 400)

  const existing = await c.env.DB.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first()
  if (existing) return c.json({ ok: false, error: '该 slug 已被占用' }, 409)

  // users.email 全局唯一（无 tenant 维度），同一邮箱不能注册第二个租户。
  // 预检给出友好提示；batch 的 catch 兜住并发下的竞态。
  const emailTaken = await c.env.DB.prepare('SELECT 1 AS ok FROM users WHERE email = ?').bind(ownerEmail).first()
  if (emailTaken) return c.json({ ok: false, error: '该邮箱已被注册，请更换 owner_email' }, 409)

  const passwordHash = await hashPassword(password)

  let txResult: any[]
  try {
    txResult = await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO tenants (slug, owner_email, tier, status) VALUES (?, ?, ?, ?)').bind(slug, ownerEmail, 'free', 'active'),
      c.env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').bind(ownerEmail, passwordHash),
    ])
  } catch (e) {
    // D1 batch 非事务性：租户行可能已插入而用户行冲突失败，留下「无成员」的孤儿租户。
    // 这里不回滚（D1 无跨语句事务），返回 409 并提示可用 /admin/tenants 停用该孤儿租户。
    if (/UNIQUE constraint failed/i.test(String((e as any)?.message || e))) {
      return c.json({ ok: false, error: '该邮箱已被注册，请更换 owner_email（若已产生同名租户，可在 /admin/tenants 停用）' }, 409)
    }
    safeError('saas tenant register failed', e)
    return c.json({ ok: false, error: '注册失败，请稍后重试' }, 503)
  }
  const tenantId = Number((txResult[0] as any)?.meta?.last_row_id || 0)
  const userId = Number((txResult[1] as any)?.meta?.last_row_id || 0)
  await c.env.DB.prepare('INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (?, ?, ?)').bind(tenantId, userId, 'owner').run()

  return c.json({ ok: true, tenant: { id: tenantId, slug, tier: 'free' }, user: { id: userId } }, 201)
})

/** 用户登录:按 slug 定位租户 → users 表校验邮箱+密码 → 发 KV 会话 */
tenantRoutes.post('/tenants/:slug/login', rateLimit(10, 60, 'saas-login'), async (c) => {
  const slug = c.req.param('slug').toLowerCase()
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const email = String(b.email || '').trim().toLowerCase()
  const password = String(b.password || '')
  if (!email || !password) return c.json({ ok: false, error: 'email 与 password 必填' }, 400)

  const tenant = await c.env.DB.prepare('SELECT id, slug, tier, status FROM tenants WHERE slug = ?').bind(slug).first() as any
  if (!tenant) return c.json({ ok: false, error: '租户不存在' }, 404)
  if (String(tenant.status) !== 'active') return c.json({ ok: false, error: '租户已停用' }, 403)

  // users.email 全局唯一，但同一邮箱可能因历史数据关联多个租户；
  // 按 tenant_members 连接，确保取到的是「本租户的」那个 user 行，
  // 否则第二个租户会永远取到第一个租户的 user 行而无法登录。
  const user = await c.env.DB.prepare(
    'SELECT u.id, u.password_hash FROM users u JOIN tenant_members m ON m.user_id = u.id WHERE u.email = ? AND m.tenant_id = ?',
  ).bind(email, Number(tenant.id)).first() as any
  if (!user) return c.json({ ok: false, error: '邮箱或密码错误' }, 401)
  const check = await verifyPassword(password, String(user.password_hash))
  if (!check.valid) return c.json({ ok: false, error: '邮箱或密码错误' }, 401)

  // 必须是该租户成员
  const member = await c.env.DB.prepare('SELECT 1 AS ok FROM tenant_members WHERE tenant_id = ? AND user_id = ?').bind(Number(tenant.id), Number(user.id)).first()
  if (!member) return c.json({ ok: false, error: '该用户不属于此租户' }, 403)

  const token = crypto.randomUUID()
  await c.env.CACHE_KV.put('saas_session:' + token, JSON.stringify({ userId: Number(user.id), tenantId: Number(tenant.id), email, exp: Date.now() + SESSION_TTL_SECONDS * 1000 }), {
    expirationTtl: SESSION_TTL_SECONDS,
  })
  return c.json({ ok: true, token, tenant: { id: Number(tenant.id), slug, tier: tenant.tier } })
})

/** 当前会话信息:Authorization: Bearer <token> */
tenantRoutes.get('/auth/me', async (c) => {
  const auth = c.req.header('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return c.json({ ok: false, error: '缺少或无效 Authorization Bearer token' }, 401)

  const raw = await c.env.CACHE_KV.get('saas_session:' + token)
  if (!raw) return c.json({ ok: false, error: '会话无效或已过期' }, 401)
  try {
    const session = JSON.parse(raw) as { userId: number; tenantId: number; exp: number }
    if (Date.now() > Number(session.exp || 0)) {
      await c.env.CACHE_KV.delete('saas_session:' + token)
      return c.json({ ok: false, error: '会话已过期,请重新登录' }, 401)
    }
    const row = await c.env.DB.prepare('SELECT id, slug, tier, status FROM tenants WHERE id = ?').bind(session.tenantId).first() as any
    if (!row) return c.json({ ok: false, error: '租户不存在' }, 404)
    return c.json({ ok: true, userId: session.userId, tenant: { id: Number(row.id), slug: row.slug, tier: row.tier, status: row.status } })
  } catch (e) {
    safeError('saas session parse failed', e)
    return c.json({ ok: false, error: '会话无效' }, 401)
  }
})
