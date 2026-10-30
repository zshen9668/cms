import type { Context } from 'hono'
import { SettingsStore } from './settingsStore'
const PLACEHOLDER = 'https://your-domain.com'

// SITE_URL 是可选的公开站点地址覆盖项，不是 Secret。
// 优先级：后台「系统设置」site_url → Cloudflare SITE_URL 兼容变量 → 当前请求 origin。
// 因此首次部署、绑定 workers.dev 或自定义域名时都不要求预填 SITE_URL。
export async function resolveSiteUrl(c: Context): Promise<string> {
  let configured = ''
  try {
    const value = await SettingsStore.for(c.env).get('site_url', '')
    configured = String(value || '').trim()
  } catch {
    // D1 不可用时继续使用环境变量/请求 origin 兜底。
  }
  configured = configured || String(c.env.SITE_URL || '').trim()
  if (configured && configured !== PLACEHOLDER) return configured.replace(/\/$/, '')
  try {
    return new URL(c.req.url).origin
  } catch {
    return (configured || PLACEHOLDER).replace(/\/$/, '')
  }
}
