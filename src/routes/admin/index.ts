import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { requireAdmin } from '../../middleware/authGuard'
import { requireRbac } from '../../middleware/rbac'

/**
 * 白标 CMS 后台路由按功能模块拆分。
 * 各子模块独立维护，这里统一挂载到 /admin 前缀。
 */
export const adminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

import { adminDashboardRoutes } from './dashboard'
import { adminAuthRoutes } from './auth'
import { adminArticlesRoutes } from './articles'
import { adminCaseRoutes } from './cases'
import { adminCitiesRoutes } from './cities'
import { adminServicesRoutes } from './services'
import { adminSeoRoutes } from './seo'
import { adminKeywordsRoutes } from './keywords'
import { adminRankingRoutes } from './rankings'
import { adminSubprojectsRoutes } from './subprojects'
import { adminMessagesRoutes } from './messages'
import { adminNewsRoutes } from './news'
import { adminSettingsRoutes } from './settings'
import { adminMediaRoutes } from './media'
import { adminSystemRoutes } from './system'
import { adminSystemSecretRoutes } from './systemSecrets'
import { adminAiQaRoutes } from './aiQa'
import { adminPagesRoutes } from './pages'
import { adminTenantsRoutes } from './tenants'

// 免登录入口（初始化/恢复/登录）必须先挂载；
// 之后的 use('*') 对其余全部后台路由强制登录（与旧单体 admin.ts 行为一致）。
adminRoutes.route('/', adminAuthRoutes)

adminRoutes.use('*', requireAdmin)

adminRoutes.use('*', requireRbac())

// 子模块内部路径如 /articles 等直接挂载到 /admin 下保持原路径；仪表板 /admin 优先匹配
adminRoutes.route('/', adminDashboardRoutes)
adminRoutes.route('/', adminArticlesRoutes)
adminRoutes.route('/', adminCaseRoutes)
adminRoutes.route('/', adminCitiesRoutes)
adminRoutes.route('/', adminServicesRoutes)
adminRoutes.route('/', adminSeoRoutes)
adminRoutes.route('/', adminKeywordsRoutes)
adminRoutes.route('/', adminRankingRoutes)
adminRoutes.route('/', adminSubprojectsRoutes)
adminRoutes.route('/', adminMessagesRoutes)
adminRoutes.route('/', adminNewsRoutes)
adminRoutes.route('/', adminSettingsRoutes)
adminRoutes.route('/', adminMediaRoutes)
adminRoutes.route('/', adminSystemRoutes)
adminRoutes.route('/', adminSystemSecretRoutes)
adminRoutes.route('/', adminAiQaRoutes)
adminRoutes.route('/', adminPagesRoutes)
adminRoutes.route('/', adminTenantsRoutes)
