import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { renderSetupPage, renderLoginPage, renderRecoverPage, renderSetupSuccessPage } from '../../templates/admin'
import { STYLESHEET_HREF } from '../../templates/assets'
import { safeError } from '../../utils/safeLogger'
import { verifyTurnstile, turnstileSiteKey } from '../../plugins/turnstile/index'
import { getTenantId } from '../../db/scoped'
import { getJwtSecret, signToken } from '../../utils/auth'
import { hashPassword, verifyPassword, validatePasswordStrength, getPbkdf2Iterations, timingSafeEqual, DUMMY_PASSWORD_HASH } from '../../utils/password'
import { isLoginLocked, recordLoginFailure, clearLoginFailures, LOGIN_LOCK_SECONDS } from '../../middleware/security'
import { SettingsStore } from '../../utils/settingsStore'
import { getSystemSecret } from '../../utils/systemSecrets'
import { INDUSTRY_PRESETS, getIndustryPreset } from '../../utils/industryPresets'
import { applyIndustryConfig } from './settings'

export const adminAuthRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/**
 * migrations/0001_baseline.sql 应该建出的全部表。
 *
 * 这里只做「校验」，不再像旧版 ensureBaseTables 那样自行 CREATE TABLE。
 * 原因：运行时建表的 schema 与迁移产出的 schema 互相冲突 —— 旧 ensureBaseTables 把
 * settings 建成 `key PRIMARY KEY`（迁移是 `(key, tenant_id)` 复合主键）、把 subprojects
 * 建成 `(name, slug, description, tenant_id)`（迁移是 section/label_zh/title_zh/... 那套）。
 * 站长若先访问 /admin/setup，错误的表会被先建出来，之后迁移里的
 * `CREATE TABLE IF NOT EXISTS` 静默跳过，后台就会持续报 "no such column: section"。
 *
 * 现在的约定：schema 的唯一真相源是 migrations/，由 `npm run deploy` 自动应用。
 * 若表缺失，就直接告诉站长怎么补，而不是悄悄造出第二套结构。
 */
const REQUIRED_SCHEMA_TABLES = [
  'tenants', 'users', 'tenant_members', 'tier_limits',
  'settings', 'admin_users',
  'cities', 'services', 'keywords',
  'articles', 'article_versions', 'cases',
  'news_sources', 'collection_logs', 'review_logs',
  'messages', 'message_replies', 'email_replies',
  'form_schemas', 'form_submissions',
  'subprojects', 'subproject_items',
  'media_assets', 'social_posts', 'daily_stats', 'submit_logs',
  'geo_citations', 'ai_crawler_hits', 'roles', 'api_keys',
]

async function missingSchemaTables(env: Bindings): Promise<string[]> {
  if (!env.DB) return [...REQUIRED_SCHEMA_TABLES]
  try {
    const rows = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    const have = new Set((rows.results as Array<{ name: string }>).map((r) => r.name))
    return REQUIRED_SCHEMA_TABLES.filter((t) => !have.has(t))
  } catch {
    return [...REQUIRED_SCHEMA_TABLES]
  }
}

function renderSchemaMissing(missing: string[]): string {
  const preview = missing.slice(0, 8).join(', ')
  const more = missing.length > 8 ? ` 等 ${missing.length} 张` : ''
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1" /><title>数据库结构未初始化</title><link rel="stylesheet" href="${STYLESHEET_HREF}" /></head><body class="auth-page"><div class="card auth-card"><h2>数据库结构未初始化</h2><p style="color:var(--muted);font-size:13px;line-height:1.8">D1 已绑定，但业务表还没建出来（缺少 ${preview}${more}）。<br />请在项目目录执行下面任一方式，再刷新本页：</p><p style="font-size:13px;line-height:1.9"><strong>方式一（推荐）</strong>：在项目目录运行<br /><code>npm run deploy</code><br />脚本会自动创建资源、应用全部迁移、发布 Worker。</p><p style="font-size:13px;line-height:1.9"><strong>方式二</strong>：只补数据库结构<br /><code>npx wrangler d1 migrations apply DB --remote</code></p><p style="font-size:12px;color:var(--muted);line-height:1.8">系统不再自动建表：运行时建表会与迁移结构冲突，导致后台出现 no such column 报错。</p><p><a class="btn" href="/admin/setup">已执行完成，重新检测</a></p></div></body></html>`
}

async function dbReady(env: Bindings): Promise<boolean> {
  if (!env.DB) return false
  try { await env.DB.prepare('SELECT COUNT(*) as n FROM admin_users LIMIT 1').first(); return true } catch { return false }
}

/**
 * 解析生效的初始化 / 恢复令牌。
 *
 * 来源优先级：后台「系统密钥 → 安全与登录」中保存的加密值 → 环境变量 SETUP_TOKEN。
 * 首次部署时后台还进不去，所以环境变量仍作为引导手段保留；
 * 登录成功之后可以随时改到「系统密钥」里，无需再动 Cloudflare 配置。
 */
async function resolveSetupToken(env: Bindings): Promise<string> {
  return getSystemSecret(env, 'SETUP_TOKEN')
}

adminAuthRoutes.get('/setup', async (c) => {
  if (!c.env.DB) {
    return new Response('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>初始化管理员账号</title></head><body class="auth-page"><h2>D1 数据库未绑定</h2><p>Worker 尚未绑定 D1 数据库 <code>DB</code>。</p><p>请在 Cloudflare Dashboard → 你的 Worker → Settings → Variables and Secrets → 绑定 D1 数据库 <code>white-label-cms-db</code> 为 <code>DB</code>，然后重新部署。</p><p><a href="/admin/setup">重新加载</a></p></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  try {
    const missing = await missingSchemaTables(c.env)
    if (missing.length > 0) return new Response(renderSchemaMissing(missing), { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    const count = (await c.env.DB.prepare('SELECT COUNT(*) as n FROM admin_users').first()) as any
    if (count?.n > 0) return c.redirect('/admin/login')
    const requireToken = !!(await resolveSetupToken(c.env))
    return c.html(renderSetupPage(undefined, { requireToken, industryPresets: INDUSTRY_PRESETS.map((p) => ({ id: p.id, label: p.label })) }))
  } catch (e: any) {
    const msg = String(e?.message || e)
    safeError('D1 setup check failed', e)
    return new Response('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>初始化管理员账号</title></head><body class="auth-page"><h2>系统初始化异常</h2><p>' + msg + '</p><p><a href="/admin/setup">重新加载</a></p></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
})

adminAuthRoutes.post('/setup', async (c) => {
  try {
    if (!c.env.DB) return new Response(renderSetupPage('D1 数据库未绑定。请先在 Cloudflare 中绑定变量 DB。', { requireToken: false }), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    const missing = await missingSchemaTables(c.env)
    if (missing.length > 0) return new Response(renderSchemaMissing(missing), { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    const setupToken = await resolveSetupToken(c.env)
    const requireToken = !!setupToken
    if (!(await dbReady(c.env))) return new Response(renderSetupPage('D1 基础表尚未就绪。请确认 DB 绑定指向正确的 D1 数据库，然后刷新重试。', { requireToken }), { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 })
    const b = await c.req.parseBody()
    if (setupToken && !timingSafeEqual(String(b['setup_token'] || '').trim(), setupToken)) return new Response(renderSetupPage('初始化令牌不正确。请填写「系统密钥 → 安全与登录」里配置的初始化令牌。', { requireToken: true }), { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 403 })
    const email = String(b['email'] || '').trim().toLowerCase()
    const password = String(b['password'] || '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return new Response(renderSetupPage('请填写正确的管理员邮箱', { requireToken }), { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 400 })
    const passwordError = validatePasswordStrength(password, email)
    if (passwordError) return new Response(renderSetupPage(passwordError, { requireToken }), { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 400 })
    let hash: string
    try { hash = await hashPassword(password, getPbkdf2Iterations(c.env)) } catch (e: any) {
      const elapsedHint = (e as any)?.message?.includes('CPU') || (e as any)?.message?.includes('timeout') || (e as any)?.message?.includes('limit')
        ? '（疑似 Workers CPU 时间限制，PBKDF2 600000 次迭代过长）'
        : ''
      safeError('admin setup password hashing failed', e as Error, { email, hint: elapsedHint })
      return new Response(renderSetupPage('管理员密码加密失败，请稍后重试；若持续出现，请确认 Worker 运行环境支持 PBKDF2 高迭代次数。', { requireToken }), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    let created: any
    try { created = await c.env.DB.prepare(`INSERT INTO admin_users (email, password_hash, role) SELECT ?, ?, 'admin' WHERE NOT EXISTS (SELECT 1 FROM admin_users) RETURNING id`).bind(email, hash).first() } catch (e: any) { safeError('admin setup insert failed', e); const msg = String(e?.message || e); if (/no such table|admin_users/i.test(msg)) return new Response(renderSetupPage('D1 基础表不存在或 DB 绑定指向错误的数据库。请在项目目录执行 `npm run deploy` 自动应用迁移后重试。', { requireToken }), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); return new Response(renderSetupPage('管理员账号创建失败，请检查 D1 状态后重试。', { requireToken }), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) }
    if (!created?.id) return c.redirect('/admin/login')
    let jwtSecret: string
    try { jwtSecret = await getJwtSecret(c.env) } catch (e) { safeError('JWT secret initialization failed', e); return new Response(renderSetupPage('登录密钥初始化失败。请确认 CACHE_KV 已绑定，或在「系统密钥 → 安全与登录」中设置登录会话签名密钥。', { requireToken }), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) }
    try { await SettingsStore.for(c.env).set('seed_state', 'installed') } catch (e) { console.warn('[admin] mark starter seed state installed failed', { error: String(e) }) }

    // 一键应用行业模板：创建管理员后立即写入行业配置、城市、服务与关键词矩阵
    let industryApplied = false
    let industryLabel = ''
    let citiesInserted = 0
    let servicesInserted = 0
    const presetId = String((b as Record<string, unknown>)['industry_preset_id'] || '').trim()
    if (presetId) {
      try {
        const preset = getIndustryPreset(presetId)
        if (preset) {
          industryLabel = preset.label
          const result = await applyIndustryConfig(c.env, Number(created.id), {
            industry_type: preset.id,
            industry_keywords: preset.industryKeywords,
            target_customers: preset.targetCustomers,
            service_features: preset.serviceFeatures,
            application_scenarios: preset.applicationScenarios,
          })
          industryApplied = true
          citiesInserted = result.citiesInserted
          servicesInserted = result.servicesInserted
        }
      } catch (e) {
        safeError('setup industry config apply failed', e)
      }
    }

    const token = await signToken({ uid: Number(created.id), email, role: 'admin', pwd: await passwordFingerprintForSession(hash) }, jwtSecret)
    c.header('Set-Cookie', `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`)
    return c.html(renderSetupSuccessPage({ siteName: c.env.SITE_NAME, industryApplied, industryLabel, citiesInserted, servicesInserted }))
  } catch (e) { safeError('admin setup unexpected error', e); return new Response('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>初始化管理员账号</title></head><body class="auth-page"><h2>系统初始化出现异常，请稍后重试。</h2><p><a href="/admin/setup">重新加载</a></p></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) }
})

async function passwordFingerprintForSession(passwordHash: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passwordHash))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

adminAuthRoutes.get('/recover', async (c) => {
  const requireToken = !!(await resolveSetupToken(c.env))
  return c.html(renderRecoverPage(c.req.query('error') || '', { requireToken }))
})

adminAuthRoutes.post('/recover', async (c) => {
  const b = await c.req.parseBody()
  const setupToken = await resolveSetupToken(c.env)
  const requireToken = !!setupToken
  const submittedToken = String(b.setup_token || '').trim()
  const email = String(b.email || '').trim().toLowerCase()
  const password = String(b.password || '')
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'

  if (await isLoginLocked(c.env.CACHE_KV, email, ip)) {
    return c.html(renderRecoverPage(`恢复失败次数过多，请 ${Math.round(LOGIN_LOCK_SECONDS / 60)} 分钟后再试`), 429)
  }

  if (!setupToken || !submittedToken || !timingSafeEqual(submittedToken, setupToken)) {
    await recordLoginFailure(c.env.CACHE_KV, email, ip)
    return c.html(renderRecoverPage('恢复令牌不正确。请使用「系统密钥 → 安全与登录」中配置的初始化令牌。', { requireToken }), 403)
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await recordLoginFailure(c.env.CACHE_KV, email, ip)
    return c.html(renderRecoverPage('请填写正确的管理员邮箱。'), 400)
  }
  const passwordError = validatePasswordStrength(password, email)
  if (passwordError) {
    await recordLoginFailure(c.env.CACHE_KV, email, ip)
    return c.html(renderRecoverPage(passwordError), 400)
  }
  const user = await c.env.DB.prepare('SELECT id FROM admin_users ORDER BY id LIMIT 1').first() as any
  if (!user) return c.redirect('/admin/setup')
  const hash = await hashPassword(password, getPbkdf2Iterations(c.env))
  await c.env.DB.prepare('UPDATE admin_users SET email=?, password_hash=?, role=\'admin\' WHERE id=?').bind(email, hash, user.id).run()
  await clearLoginFailures(c.env.CACHE_KV, email, ip)
  return c.redirect('/admin/login?recovered=1')
})

adminAuthRoutes.get('/login', async (c) => {
  if (!c.env.DB) return c.html(renderLoginPage('系统正在初始化，请稍后重试。'))
  try { const count = (await c.env.DB.prepare('SELECT COUNT(*) as n FROM admin_users').first()) as any; if (Number(count?.n || 0) === 0) return c.redirect('/admin/setup') } catch (e) { safeError('D1 login bootstrap check failed', e); return c.html(renderLoginPage('系统正在初始化，请稍后重试。')) }
  const tsKey = await turnstileSiteKey(c.env)
  return c.html(renderLoginPage(c.req.query('recovered') === '1' ? '管理员账号已恢复，请使用新密码登录。' : undefined, tsKey || undefined))
})

adminAuthRoutes.post('/login', async (c) => {
  const body = await c.req.parseBody()
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!c.env.DB) return c.html(renderLoginPage('系统正在初始化，请稍后重试。'))
  const ts = await verifyTurnstile(c.env, getTenantId(c), String(body['cf-turnstile-response'] || ''), c.req.header('cf-connecting-ip'))
  if (!ts.valid) return c.html(renderLoginPage('人机校验失败，请刷新重试'))
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
  if (await isLoginLocked(c.env.CACHE_KV, email, ip)) return c.html(renderLoginPage(`登录失败次数过多，请 ${Math.round(LOGIN_LOCK_SECONDS / 60)} 分钟后再试`), 429)
  let user: any
  try { user = await c.env.DB.prepare('SELECT * FROM admin_users WHERE email = ?').bind(email).first() } catch (e) { safeError('D1 login query failed', e); return c.html(renderLoginPage('系统正在初始化，请稍后重试。')) }
  const targetIterations = getPbkdf2Iterations(c.env)
  const passwordCheck = await verifyPassword(password, String(user?.password_hash || DUMMY_PASSWORD_HASH), targetIterations)
  if (!user || !passwordCheck.valid) { await recordLoginFailure(c.env.CACHE_KV, email, ip); return c.html(renderLoginPage('邮箱或密码错误'), 401) }
  await clearLoginFailures(c.env.CACHE_KV, email, ip)
  let sessionPasswordHash = String(user.password_hash || '')
  if (passwordCheck.needsUpgrade) { try { const upgradedHash = await hashPassword(password, targetIterations); await c.env.DB.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').bind(upgradedHash, user.id).run(); sessionPasswordHash = upgradedHash } catch (e) { console.warn('[admin] admin password hash upgrade failed', { error: String(e) }) } }
  let jwtSecret: string
  try { jwtSecret = await getJwtSecret(c.env) } catch (e) { safeError('JWT secret initialization failed', e); return c.html(renderLoginPage('登录密钥尚未初始化，请确认 CACHE_KV 已绑定，或在「系统密钥 → 安全与登录」中设置登录会话签名密钥')) }
  const token = await signToken({ uid: (user as any).id, email, pwd: await passwordFingerprintForSession(sessionPasswordHash) }, jwtSecret)
  c.header('Set-Cookie', `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`)
  return c.redirect('/admin')
})

export { passwordFingerprintForSession }
