import type { CmsPlugin } from './types'
import { versioningPlugin } from './versioning/index'
import { formsPlugin } from './forms/index'
import { turnstilePlugin } from './turnstile/index'
import { analyticsPlugin } from './analytics/index'
import { apiKeysPlugin } from './apiKeys/index'
import { rbacPlugin } from './rbac/index'

export const plugins: CmsPlugin[] = [versioningPlugin, formsPlugin, turnstilePlugin, analyticsPlugin, apiKeysPlugin, rbacPlugin]

/**
 * 插件注册表:新增插件时在此 import + 加入数组,并同步 scripts/check-plugin-crons.mjs。
 */
export function listPlugins(): CmsPlugin[] {
  return plugins
}
