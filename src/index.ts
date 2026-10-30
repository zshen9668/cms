import { Hono } from 'hono'
import type { Bindings, Variables } from './types'
import { publicRoutes } from './routes/public'
import { apiRoutes } from './routes/api'
import { apiV2Routes } from './routes/apiV2'
import { aiQaRoutes } from './routes/aiQa'
import { wecomRoutes } from './routes/wecom'
import { adminRoutes } from './routes/admin'
import { adminModuleRoutes } from './routes/adminModules'
import { seoRoutes } from './routes/seo'
import { tenantRoutes } from './routes/tenant'
import { securityHeaders, rateLimit, csrfProtection, ensureCsrfCookie } from './middleware/security'
import { tenantMiddleware } from './middleware/tenant'
import { aiCrawlerStats } from './middleware/aiCrawlerStats'
import { requireAdmin } from './middleware/authGuard'
import { requireRbac } from './middleware/rbac'
import { runNewsCollection } from './cron/newsCollector'
import { cleanExpiredLogsAllTenants } from './cron/logRetention'
import { detectLocale, SUPPORTED } from './utils/i18n'
import { normalizeLocale } from './utils/localeResolve'
import { getEnabledLocales } from './modules/languageManager/storage'
import { getAiSettings, runConfiguredAi } from './utils/aiSettings'
import { getAiResponseText } from './utils/aiJson'
import { resolveSiteUrl } from './utils/siteUrl'
import { SettingsStore } from './utils/settingsStore'
import { mountPlugins, runScheduledPlugins } from './plugins/types'
import { listPlugins } from './plugins/registry'
import { safeError, safeWarn } from './utils/safeLogger'
import { resolveMediaKey, extractMediaKeyFromUrl } from './utils/safePath'
import { renderLayout, escapeHtml } from './templates/layout'
import { render404Page } from './templates/public'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.onError((err, c) => {
  safeError('Unhandled Worker error', err)
  safeError('Unhandled Worker error stack', err instanceof Error ? err.stack : String(err))

  const res = c.res
  if (res) {
    // 响应已被 handler 消费或已提交，不再修改，避免抛出未捕获异常导致 1101
    try { res.headers.set('Cache-Control', 'no-store') } catch {}
  }

  const isDev = c.env.ENVIRONMENT === 'development'
  const msg = isDev ? String((err as any)?.message || err || '').slice(0, 200) : undefined

  if (c.req.path.startsWith('/api/')) {
    return c.json({
      ok: false,
      error: '服务器暂时不可用，请稍后重试',
      ...(msg ? { detail: msg } : {})
    }, 500)
  }
  if (c.req.path === '/admin/setup' || c.req.path === '/admin/login') {
    return new Response(
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>初始化/登录失败</title></head>' +
      '<body class="auth-page"><h2>初始化/登录失败</h2>' +
      '<p>' + escapeHtml(String((err as any)?.message || err || '未知错误')) + '</p>' +
      '<p>请确保后端已部署最新版本，并确认 D1 数据库 <code>white-label-cms-db</code> 已绑定为 <code>DB</code>。</p>' +
      '<p><a href="/admin/setup">重新加载</a></p></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 500 }
    )
  }
  return new Response('服务器暂时不可用，请稍后重试', { status: 500 })
})

app.use('*', securityHeaders)
app.use('*', tenantMiddleware())
// AI 爬虫访问统计必须在 tenantMiddleware 之后：它要用到已解析出的 tenantId。
// 中间件内部只对命中爬虫 UA 的公开 GET 请求写库，普通访客零开销。
app.use('*', aiCrawlerStats())
app.use('*', async (c, next) => {
  const path = c.req.path
  const isPrivate = path.startsWith('/admin') || path.startsWith('/api') || path === '/healthz'
  // 后台与 API 不做多语言：文案固定中文，且 /api/* 的响应会被 No-Store。
  const enabled = isPrivate ? [...SUPPORTED] : await getEnabledLocales(c.env)
  let locale = detectLocale(c, enabled)
  // `?lang=xx` 同时写一次性 cookie `_langq`，让 detectLocale 立刻按新语言渲染；
  // 不再直接覆盖持久 `lang` cookie（那样会被下一次请求残留的旧值盖住）。
  const queryLang = !isPrivate ? normalizeLocale(c.req.query('lang')) : null
  if (queryLang && enabled.includes(queryLang)) {
    c.header('Set-Cookie', '_langq=' + queryLang + '; Path=/; Max-Age=60; SameSite=Lax')
  }
  c.set('locale', locale)
  c.set('multilingual', !isPrivate && enabled.length > 1)
  await next()
})
app.use('/admin/login', rateLimit(10, 60, 'admin-login'))
app.use('/admin/setup', rateLimit(10, 60, 'admin-setup'))
app.use('/admin/recover', rateLimit(5, 60, 'admin-recover'))
// healthz 匿名可访问(?probe=ai 会消耗 Workers AI 配额),限流避免被循环调用耗尽额度。
app.use('/healthz', rateLimit(30, 60, 'healthz'))
// CSRF 双提交 Cookie:带 X-CSRF-Token 时严格校验,缺失时回退 Origin/Sec-Fetch-Site(兼容现有 admin 表单)
// 必须先确保 cookie 已下发,否则 csrfProtection 的「cookie 缺失」分支会拦下所有后台表单提交。
app.use('/admin/*', ensureCsrfCookie())
app.use('/admin/*', csrfProtection())

app.get('/healthz', async (c) => {
  const env = c.env
  let dbOk = false
  let dbSchemaOk = false
  let missingTables: string[] = []
  if (env.DB) {
    dbOk = true
    try {
      await env.DB.prepare('SELECT 1').first()
      const required = [
        'cities', 'services', 'keywords', 'articles', 'news_sources',
        'messages', 'admin_users', 'settings', 'submit_logs',
        'review_logs', 'collection_logs', 'daily_stats', 'social_posts', 'media_assets', 'subprojects', 'subproject_items', 'message_replies',
      ]
      const placeholders = required.map(() => '?').join(',')
      const rows = (await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`
      ).bind(...required).all()).results as any[]
      const present = new Set(rows.map((row) => row.name))
      missingTables = required.filter((name) => !present.has(name))
      dbSchemaOk = missingTables.length === 0
    } catch (e) {
      safeError('healthz D1 check failed', e)
    }
  }
  const probe = c.req.query('probe') === '1'
  const probeAi = c.req.query('probe') === 'ai'
  const deep: Record<string, any> = {}
  if (probe || probeAi) {
    try { await env.CACHE_KV.put('__healthz_probe__', 'ok', { expirationTtl: 60 }); deep['kv'] = (await env.CACHE_KV.get('__healthz_probe__')) === 'ok'; await env.CACHE_KV.delete('__healthz_probe__') } catch (e: any) { deep['kv'] = false; deep['kv_error'] = String(e?.message || e) }
    try { const key = '__healthz_probe__/' + crypto.randomUUID(); await env.R2_MEDIA.put(key, 'ok', { httpMetadata: { contentType: 'text/plain' } }); const object = await env.R2_MEDIA.head(key); await env.R2_MEDIA.delete(key); deep['r2'] = !!object } catch (e: any) { deep['r2'] = false; deep['r2_error'] = String(e?.message || e) }
    if (probeAi) {
      const aiSettings = await getAiSettings(env, 1)
      if (!aiSettings.enabled) {
        deep['ai'] = true
        deep['ai_status'] = 'disabled'
        deep['ai_model'] = aiSettings.model
      } else {
        try {
          const res: any = await runConfiguredAi(env, { messages: [{ role: 'user', content: 'Reply with exactly OK' }] }, aiSettings)
          const response = getAiResponseText(res).trim()
          if (!response) throw new Error('Workers AI 返回空响应')
          deep['ai'] = response.length > 0
          deep['ai_model'] = aiSettings.model
          deep['ai_response'] = response.slice(0, 40)
        } catch (e: any) {
          deep['ai'] = false
          deep['ai_model'] = aiSettings.model
          deep['ai_error'] = String(e?.message || e)
        }
      }
    } else {
      deep['ai'] = true
      deep['ai_status'] = 'skipped'
      deep['ai_hint'] = 'use ?probe=ai to test Workers AI (consumes quota)'
    }
  }
  return c.json({
    ok: dbOk && dbSchemaOk && (!(probe || probeAi) || (deep['kv'] === true && deep['r2'] === true && deep['ai'] === true)),
    bindings: {
      DB: dbOk,
      CACHE_KV: !!env.CACHE_KV,
      R2_MEDIA: !!env.R2_MEDIA,
      AI: !!env.AI,
      ASSETS: !!env.ASSETS,
    },
    d1_schema: dbSchemaOk,
    missing_tables: missingTables,
    probe: (probe || probeAi) ? deep : undefined,
    worker: env.SITE_NAME || 'white-label-cms',
  })
})

app.get('/wechat-qr', async (c) => {
  const bucket = c.env.R2_MEDIA
  if (!bucket) return c.notFound()
  try {
    const configured = String(await SettingsStore.for(c.env).get('contact_qr_url', '') || '').trim()
    if (!configured.startsWith('/media/')) return c.notFound()
    const rawKey = configured.slice('/media/'.length)
    const key = resolveMediaKey(rawKey)
    if (!key) return c.notFound()
    const object = await bucket.get(key)
    if (!object || object.size <= 0) return c.notFound()
    const ext = key.split('.').pop()?.toLowerCase() || ''
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    }
    const bytes = await object.arrayBuffer()
    if (!bytes.byteLength) return c.notFound()
    const headers = new Headers()
    headers.set('Content-Type', mimeTypes[ext] || 'application/octet-stream')
    headers.set('Content-Disposition', 'inline')
    headers.set('Content-Length', String(bytes.byteLength))
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate')
    headers.set('Cloudflare-CDN-Cache-Control', 'no-store')
    return new Response(bytes, { headers })
  } catch (e) {
    safeError('wechat QR read failed', e)
    return c.notFound()
  }
})

app.route('/', publicRoutes)

app.get('/media/*', async (c) => {
  const bucket = c.env.R2_MEDIA
  if (!bucket) return c.text('R2 媒体存储未配置', 503)
  const key = extractMediaKeyFromUrl(c.req.url)
  if (!key) return c.notFound()
  try {
    const object = await bucket.get(key)
    if (!object) return c.notFound()
    const headers = new Headers()
    object.writeHttpMetadata(headers)
    if (!headers.get('Content-Type')) {
      const ext = key.split('.').pop()?.toLowerCase() || ''
      const fallbackTypes: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
      }
      headers.set('Content-Type', fallbackTypes[ext] || 'application/octet-stream')
    }
    headers.set('Content-Disposition', 'inline')
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('ETag', object.httpEtag)
    headers.set('Content-Length', String(object.size))
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('Cloudflare-CDN-Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('Cache-Tag', 'whitelabel-cms-r2-' + key.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 900))
    return new Response(object.body, { headers })
  } catch (e) {
    safeError('R2 media read failed', e)
    return c.text('媒体读取失败，请稍后重试', 503)
  }
})

app.route('/api', apiRoutes)
app.route('/api/v2', apiV2Routes)
// 智能问答公开接口与企业微信回调：都挂在 /api 前缀下（不经过后台鉴权，
// 各自内部有独立的限流与签名校验）。
app.route('/api/ai', aiQaRoutes)
app.route('/api/wecom', wecomRoutes)

/**
 * 退出登录只接受 POST。
 *
 * 后台模板里的退出入口是 `<form method="post" action="/admin/logout">` 按钮,
 * 不是链接——GET 退出会被浏览器预取、图片标签或第三方页面触发,把已登录的站长登出。
 * 这里用 POST + SameSite=Lax 会话 cookie 保证跨站无法发起。
 */
function clearAdminSessionCookie(c: any) {
  c.header('Set-Cookie', 'admin_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')
  return c.redirect('/admin/login')
}
app.post('/admin/logout', clearAdminSessionCookie)
app.route('/admin/modules', adminModuleRoutes)
app.route('/admin', adminRoutes)
app.route('/', seoRoutes)
app.route('/api/saas', tenantRoutes)

// 插件统一挂载(业务路由之后):路由内经 c.env 访问绑定;cron 在 scheduled() 中经 runScheduledPlugins 调用
// 所有插件挂载的 /admin/* 页面（API 密钥、RBAC、表单、版本、分析等）必须经过与 adminRoutes
// 相同的 requireAdmin + requireRbac 校验，避免插件后台页面绕过登录与角色模块权限。
app.use('/admin/*', requireAdmin)
app.use('/admin/*', requireRbac())
mountPlugins(app, listPlugins())

app.get('*', async (c) => {
  // 静态资源优先；ASSETS 未绑定或文件不存在时返回渲染的 404 页面，避免暴露原始 Workers Assets 404。
  if (c.env.ASSETS) {
    try {
      const res = await c.env.ASSETS.fetch(c.req.url)
      if (res.status !== 404) {
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) })
      }
    } catch {
      // ASSETS 访问失败，继续返回渲染 404
    }
  }
  const siteUrl = await resolveSiteUrl(c).catch(() => (c.req.url ? new URL(c.req.url).origin : ''))
  const locale = c.get('locale')
  return c.html(renderLayout({
    title: (locale === 'en' ? 'Page not found' : '页面不存在') + ' - ' + (c.env.SITE_NAME || '白标 CMS'),
    siteUrl, siteName: c.env.SITE_NAME || '白标 CMS', canonical: siteUrl || c.req.url, locale, currentPath: c.req.path,
  }, render404Page(c.req.path, locale)), 404)
})

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    try {
      const settings = await SettingsStore.forTenant(env, 1).getMany(['news_collection_enabled', 'news_collection_time'])
      if (settings['news_collection_enabled'] === '0') return
      const configuredTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(settings['news_collection_time'] || '')
        ? settings['news_collection_time']!
        : '08:00'
      const now = new Date()
      const beijingTotalMinutes = (((now.getUTCHours() + 8) % 24) * 60) + now.getUTCMinutes()
      const timeParts = configuredTime.split(':')
      const targetHour = Number(timeParts[0] ?? '8')
      const targetMinute = Number(timeParts[1] ?? '0')
      const targetTotalMinutes = targetHour * 60 + targetMinute
      const minutesSinceTarget = (beijingTotalMinutes - targetTotalMinutes + 1440) % 1440
      if (minutesSinceTarget >= 5) return

      const lockKey = 'news_collection:scheduled:' + targetTotalMinutes + ':' + Math.floor(beijingTotalMinutes / 5)
      try {
        const existingLock = await env.CACHE_KV.get(lockKey)
        if (existingLock) return
        await env.CACHE_KV.put(lockKey, new Date().toISOString(), { expirationTtl: 300 })
      } catch (e) {
        safeWarn('news collection schedule lock unavailable; continuing without lock', { error: String(e) })
      }

      ctx.waitUntil(runNewsCollection(env).catch((e) => safeError('scheduled news collection failed', e)))
      ctx.waitUntil(runScheduledPlugins(listPlugins(), env, ctx).catch((e) => safeError('scheduled plugin run failed', e)))

      // 每天 03:00（北京时间）执行一次日志清理，不影响 /5 新闻采集 cron
      const retentionNow = new Date()
      const beijingHour = (retentionNow.getUTCHours() + 8) % 24
      if (beijingHour === 3 && retentionNow.getUTCMinutes() < 5) {
        const lockKey = 'log_retention:scheduled:' + Math.floor(retentionNow.getUTCMinutes() / 5)
        try {
          const existingLock = await env.CACHE_KV.get(lockKey)
          if (!existingLock) {
            await env.CACHE_KV.put(lockKey, retentionNow.toISOString(), { expirationTtl: 300 })
            ctx.waitUntil(cleanExpiredLogsAllTenants(env).catch((e) => safeError('log retention scheduled failed', e)))
          }
        } catch (e) {
          safeWarn('log retention schedule lock unavailable; continuing without lock', { error: String(e) })
        }
      }
    } catch (e) {
      safeError('scheduled news collection settings check failed', e)
    }
  },
}