import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { getTenantId } from './shared'
import { renderSystemPage } from '../../templates/admin'
import { getIndexNowKey } from '../../utils/seo'
import { getSystemSecret } from '../../utils/systemSecrets'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { resolveSiteUrl } from '../../utils/siteUrl'
import { getAiSettings, runConfiguredAi } from '../../utils/aiSettings'
import { cleanExpiredLogsAllTenants } from '../../cron/logRetention'

export const adminSystemRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

adminSystemRoutes.get('/system', async (c) => {
  const env = c.env
  const checks: { label: string; ok: boolean; detail: string; level?: 'warning' | 'error' }[] = []
  const probe = c.req.query('probe') === '1'
  try { await env.DB.prepare('SELECT 1').first(); checks.push({ label: 'D1 数据库连接', ok: true, detail: '正常' }) } catch (e) { checks.push({ label: 'D1 数据库连接', ok: false, detail: String(e) }) }
  if (!env.CACHE_KV) checks.push({ label: 'KV 缓存绑定', ok: false, detail: 'CACHE_KV 未绑定' })
  else if (!probe) checks.push({ label: 'KV 缓存绑定', ok: true, detail: '已绑定；执行完整检测才会实际读写' })
  else { try { await env.CACHE_KV.put('__healthcheck__', '1', { expirationTtl: 60 }); const value = await env.CACHE_KV.get('__healthcheck__'); checks.push({ label: 'KV 缓存读写', ok: value === '1', detail: value === '1' ? '正常' : '读写值不一致' }) } catch (e) { checks.push({ label: 'KV 缓存读写', ok: false, detail: String(e) }) } }
  if (!env.R2_MEDIA) checks.push({ label: 'R2 媒体绑定', ok: false, detail: 'R2_MEDIA 未绑定' })
  else if (!probe) checks.push({ label: 'R2 媒体绑定', ok: true, detail: '已绑定；执行完整检测才会实际写入/读取/删除' })
  else { try { const probeKey = '__healthcheck__/' + crypto.randomUUID(); await env.R2_MEDIA.put(probeKey, 'ok', { httpMetadata: { contentType: 'text/plain' } }); const probeObject = await env.R2_MEDIA.head(probeKey); await env.R2_MEDIA.delete(probeKey); checks.push({ label: 'R2 媒体存储', ok: !!probeObject, detail: probeObject ? '绑定、写入、读取、删除均正常' : '写入后未找到对象' }) } catch (e) { checks.push({ label: 'R2 媒体存储', ok: false, detail: String(e) }) } }
  const aiSettings = await getAiSettings(env, getTenantId(c))
  if (!env.AI) checks.push({ label: 'Workers AI 绑定', ok: false, detail: 'AI 未绑定' })
  else if (!aiSettings.enabled) checks.push({ label: 'Workers AI 调用', ok: true, detail: `后台已停用 AI；当前模型：${aiSettings.model}` })
  else if (!probe) checks.push({ label: 'Workers AI 绑定', ok: true, detail: `已绑定；当前模型：${aiSettings.model}；执行完整检测才会实际调用模型` })
  else { try { const res: any = await runConfiguredAi(env, { messages: [{ role: 'user', content: '请回复"ok"两个字' }] }, aiSettings); if (!res) throw new Error('AI 已启用但没有返回响应'); const responseText = res.response || res.result?.response || JSON.stringify(res); checks.push({ label: 'Workers AI 调用', ok: true, detail: `模型：${aiSettings.model}；响应：${String(responseText).slice(0, 60)}` }) } catch (e) { checks.push({ label: 'Workers AI 调用', ok: false, detail: String(e) }) } }
  const jwtSecretValue = await getSystemSecret(env, 'JWT_SECRET')
  if (jwtSecretValue) checks.push({ label: 'JWT 会话密钥', ok: true, detail: '已配置，可随时在「系统密钥 → 安全与登录」中更换。' })
  else checks.push({ label: 'JWT 会话密钥', ok: true, level: 'warning', detail: '未手动配置：系统已自动在 CACHE_KV 生成随机密钥并持久化，站点可正常运行。需要固定密钥时到「系统密钥 → 安全与登录」填写即可，无需在 Cloudflare 配置。' })
  const siteUrl = await resolveSiteUrl(c)
  const siteUrlIsFallback = !env.SITE_URL || env.SITE_URL === 'https://your-domain.com'
  checks.push({ label: '站点地址 (SITE_URL)', ok: true, detail: siteUrlIsFallback ? `未手动配置，已按当前访问域名自动兜底为 ${siteUrl}（绑定自定义域名后建议在环境变量里手动改成正式域名）` : `已配置为 ${env.SITE_URL}` })
  const indexnowKey = await getIndexNowKey(env)
  checks.push({ label: 'IndexNow Key', ok: !!indexnowKey, detail: indexnowKey ? '已配置' : '未配置，前往「系统密钥 → 搜索引擎推送」填写后即可推送 Bing / Yandex / 百度' })
  try { const adminCount = (await env.DB.prepare('SELECT COUNT(*) as n FROM admin_users').first()) as any; checks.push({ label: '管理员账号', ok: adminCount.n > 0, detail: adminCount.n > 0 ? `已创建 ${adminCount.n} 个账号` : '尚未创建，访问 /admin/setup 初始化' }); const newsSourceCount = (await env.DB.prepare('SELECT COUNT(*) as n FROM news_sources WHERE is_active=1').first()) as any; checks.push({ label: '新闻采集源', ok: newsSourceCount.n > 0, detail: newsSourceCount.n > 0 ? `已启用 ${newsSourceCount.n} 个来源` : '尚未添加，前往「新闻采集管理」添加 RSS 来源后定时任务才会工作' }) } catch (e) { checks.push({ label: 'D1 业务表检查', ok: false, detail: String(e) }) }
  checks.push({ label: 'GEO · llms.txt', ok: true, detail: `已启用，可访问 ${siteUrl}/llms.txt 查看 AI 爬虫看到的站点摘要` })
  checks.push({ label: 'GEO · AI 爬虫白名单', ok: true, detail: 'robots.txt 已显式允许 GPTBot / ClaudeBot / PerplexityBot / Google-Extended / Bingbot / Baiduspider / Bytespider 等主流AI爬虫抓取' })
  checks.push({ label: 'GEO · 结构化数据', ok: true, detail: '文章页自动输出 Article 结构化数据，城市页自动输出 FAQPage 结构化数据，无需手动配置' })
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  const cspNonce = (c as any).get("cspNonce") || ""
  const csrfToken = (c as any).get("csrfToken") || ""

  // 加载上次日志清理状态（仅当前租户）
  let logRetention: { completedAt?: string; tenantId?: number; totalDeleted?: number; totalUpdated?: number } | null = null
  try {
    const raw = await env.CACHE_KV?.get('log_retention:last_clean')
    if (raw) {
      const parsed = JSON.parse(raw)
      const tenantEntry = parsed.tenants?.find((t: any) => t.tenantId === getTenantId(c))
      if (tenantEntry) {
        logRetention = {
          completedAt: parsed.completedAt,
          tenantId: tenantEntry.tenantId,
          totalDeleted: tenantEntry.totalDeleted,
          totalUpdated: tenantEntry.totalUpdated,
        }
      }
    }
  } catch {
    logRetention = null
  }

  return c.html(renderSystemPage(checks, siteName, cspNonce, csrfToken, logRetention))
})
