export type Bindings = {
  DB: D1Database
  CACHE_KV: KVNamespace
  R2_MEDIA: R2Bucket
  AI: Ai
  ASSETS: Fetcher
  SITE_NAME?: string
  SITE_URL?: string
  DEFAULT_CITY?: string
  JWT_SECRET?: string // 可选；不填时系统自动在 CACHE_KV 中生成并持久化
  SETUP_TOKEN?: string // 可选；设置后 /admin/setup 必须携带该令牌才能创建首个管理员（Cloudflare Secret）
  PBKDF2_ITERATIONS?: string // 可选；密码哈希迭代次数，默认 600000
  INDEXNOW_KEY?: string
  GOOGLE_SERVICE_ACCOUNT_JSON?: string // Google Indexing API 服务账号 JSON（整段内容作为 secret）
  EXTERNAL_AI_API_KEY?: string // 可选；OpenAI-compatible 外部 AI API 密钥（Cloudflare Secret，不入库）
  ENVIRONMENT?: string // 环境标识：development/production
}

export type TenantContext = {
  id: number
  slug: string
  tier: 'free' | 'basic' | 'pro' | 'enterprise'
  status: 'active' | 'suspended'
}

export type Variables = {
  isAdmin: boolean
  locale: 'zh-CN' | 'en'
  multilingual: boolean // 前台已启用多种语言：同一 URL 的 HTML 因人而异，不得被边缘缓存
  tenant: TenantContext // 当前请求的租户上下文
  adminUid?: number // 当前登录管理员 uid(requireAdmin 注入;未登录/非 admin 路由时不存在)
  adminRole?: string // 当前登录管理员角色(requireAdmin 注入;供角色模块权限校验复用，避免重复查库)
  apiKeyId?: number // 当前 Bearer 密钥 id(requireApiKey 注入;/api/v2 路由)
  apiKeyScope?: string // 当前 Bearer 密钥的 scope
  csrfToken?: string // CSRF 双提交令牌，由 ensureCsrfCookie 中间件生成，供后台模板渲染 <meta name="csrf-token"> 和表单隐藏字段
}
