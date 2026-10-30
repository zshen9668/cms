/**
 * 后台站点名解析(单一入口)。
 *
 * 为什么需要它:后台外壳 `renderAdminLayout` 渲染在模板层,拿不到 settings;
 * 而它要在 `<title>`、移动端头部和侧边栏品牌处显示站点名。之前 16 个模板文件里
 * 各自硬编码了产品名 `'白标 CMS'`,站长改了站点名后台也不会变。
 *
 * 现在由路由在渲染前调用本函数解析一次,再逐层传给模板函数。优先级与前台一致:
 *
 *   租户 settings.site_name  →  部署级 env.SITE_NAME  →  DEFAULT_ADMIN_SITE_NAME
 *
 * 中间那一层是有意保留的:站点还没在后台填过名字、但部署时设了 `SITE_NAME` 的情况很常见,
 * 少了它后台和前台会显示不同的名字。
 */
import type { Bindings } from '../types'
import { SettingsStore } from './settingsStore'
import { safeError } from './safeLogger'

/** 最终兜底站点名:settings 与 env 都没配置时使用。 */
export const DEFAULT_ADMIN_SITE_NAME = '白标 CMS'

/** 读 settings 时用到的绑定。只要 DB 与可选的 SITE_NAME。 */
export type AdminSiteNameEnv = Pick<Bindings, 'DB' | 'SITE_NAME'>

/**
 * 解析后台要显示的站点名。任何一步失败都退回兜底值,不抛异常——
 * 后台外壳渲染不应该因为读设置失败而 500。
 */
export async function resolveAdminSiteName(env: AdminSiteNameEnv, tenantId: number): Promise<string> {
  const envName = String(env.SITE_NAME || '').trim()
  const fallback = envName || DEFAULT_ADMIN_SITE_NAME
  try {
    const stored = await SettingsStore.forTenant(env, Number(tenantId) || 1).get('site_name')
    const name = String(stored || '').trim()
    return name || fallback
  } catch (e) {
    safeError('admin site name resolve failed; using fallback', e)
    return fallback
  }
}
