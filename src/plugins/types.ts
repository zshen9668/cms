import type { Hono } from 'hono'
import type { Bindings, Variables } from '../types'
import { safeWarn } from '../utils/safeLogger'

/**
 * 轻量插件契约(参考 SonicJS 两阶段 mount 思路,去掉 SDK 依赖)。
 * - mount 在应用启动时同步调用,注册 Hono 子路由;路由内通过 c.env 访问绑定。
 * - 单插件 mount 抛错只告警,不崩主应用。
 * - onScheduled 可选:5 分钟 cron tick 时调用(调度发布、批处理等),拿到真实 env。
 */
export type CmsPlugin = {
  id: string
  version: string
  mount(app: Hono<{ Bindings: Bindings; Variables: Variables }>): void
  onScheduled?(env: Bindings, ctx: ExecutionContext): Promise<void>
}

/** 应用启动时统一挂载(业务路由之后) */
export function mountPlugins(app: Hono<{ Bindings: Bindings; Variables: Variables }>, plugins: CmsPlugin[]) {
  for (const plugin of plugins) {
    try {
      plugin.mount(app)
    } catch (e) {
      safeWarn('plugin mount failed: ' + plugin.id, { plugin: plugin.id, error: String(e) })
    }
  }
}

/** cron tick:逐个调用声明了 onScheduled 的插件,单插件失败不影响其余 */
export async function runScheduledPlugins(plugins: CmsPlugin[], env: Bindings, ctx: ExecutionContext) {
  for (const plugin of plugins) {
    if (!plugin.onScheduled) continue
    try {
      await plugin.onScheduled(env, ctx)
    } catch (e) {
      safeWarn('plugin scheduled failed: ' + plugin.id, { plugin: plugin.id, error: String(e) })
    }
  }
}
