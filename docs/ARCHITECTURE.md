# 架构与扩展

本文描述当前代码的组织方式、插件契约与新增功能时必须遵守的约束。

## 1. 分层

```
src/index.ts          Worker 入口:中间件链 → 路由挂载 → 定时任务 → 全局错误处理
src/routes/           对外路由
  public.ts             前台页面
  seo.ts                sitemap / robots / llms.txt / 结构化数据
  api.ts                公开写接口(留言)
  aiQa.ts               智能问答公开接口
  wecom.ts              企业微信回调
  apiV2.ts              Bearer 密钥只读 API
  tenant.ts             SaaS 租户与登录
  admin/                后台聚合路由(requireAdmin + requireRbac)
  adminModules/         /admin/modules/*(同等权限校验)
src/middleware/       鉴权、RBAC、限流/CSRF/安全头、多租户识别
src/plugins/          内置插件(版本历史、表单、Turnstile、RBAC、API 密钥、分析)
src/templates/        前台与后台 HTML 模板
src/utils/            设置读写、AI 调用、SEO、安全日志、路径校验
src/db/               D1 租户作用域查询封装
src/cron/             定时任务(新闻采集、日志清理)
```

## 2. 请求链路

```
Worker 入口
  → securityHeaders / csrfProtection / rateLimit
  → tenantMiddleware        解析 /t/{slug},注入 tenant 上下文
  → 路由匹配
      /admin/*      → requireAdmin(会话 JWT)→ requireRbac(角色模块权限)
      /api/v2/*     → requireApiKey(Bearer)
      公开路由       → 各自的限流与 Turnstile 校验
  → app.onError 统一兜底:记录 safeError,API 返回 JSON,后台/登录页返回可读提示
```

**多文件协作型功能必须接线齐全**,漏一段的表现通常是「静默失效」而不是报错(例如密钥登记了但没挂路由、路由写了但没在 `index.ts` 挂载)。`npm run check:ai-qa` 这类脚本就是把这些链路逐段锁死的。

## 3. 插件契约

```ts
// src/plugins/types.ts
export type CmsPlugin = {
  id: string
  version: string
  mount(app: Hono, ctx: PluginContext): void
  crons?: string[]
}
```

- `src/plugins/registry.ts` 顺序挂载,单插件失败不影响主应用;
- 插件子路由挂到约定前缀;
- 声明了 `crons` 的插件必须与 `wrangler.toml` 的 `[triggers]` 一致,由 `npm run check:plugins` 校验。

当前内置插件:版本历史、表单、Turnstile、RBAC、API 密钥、分析。

## 4. 扩展新功能的约定

| 要做的事 | 必须同步的地方 |
|---|---|
| 新增数据表 | 新编号迁移文件 + `scripts/check-schema.mjs` 的 `REQUIRED_TABLES` + `src/routes/admin/auth.ts` 的 `REQUIRED_SCHEMA_TABLES` |
| 新增后台页面 | 写进对应 `src/templates/adminXxx.ts` 域模块,并在 `NAV_GROUPS` 里挂到某个分组 |
| 新增后台路由 | 挂到 `src/routes/admin/` 下并在 `admin/index.ts` 注册;路由快照由 `npm run check:routes -- --update` 更新 |
| 新增运行时密钥 | 登记进 `src/utils/systemSecrets.ts`(后台「系统密钥」页自动出现该字段) |
| 新增前台页面 | 加入 `src/routes/public.ts`,并确认 sitemap / 导航 / `check:public` 覆盖 |
| 改样式表 | 升 `src/templates/assets.ts` 的 `STYLESHEET_VERSION`,不要硬编码 `/styles.css` |
| 新增语言文案 | 加进 `src/utils/i18n.ts` 的词典;模板零散标签用 `pick(locale, '中文', 'English')` |

## 5. 安全不变量

- 所有后台路由默认 `requireAdmin`;`/admin/modules/*` 与 `/admin` 同等校验,不存在绕过路径。
- 公开写接口必须限流,并按需叠加 Turnstile 与蜜罐字段。
- 上传/媒体路径统一走 `src/utils/safePath.ts` 校验,文件名做 MIME + 魔数检查。
- 多租户:写路径显式绑定 `tenant_id`,读路径走 `scoped()`;禁止裸 SQL 拼接租户条件。
- 用户可控内容进入 HTML 前必须转义(`src/utils/html.ts` 的 `escapeHtml`);需要保留富文本时走 `sanitizeAiPublicHtml` 白名单。
- 模型输出与数据库内容不进入 `innerHTML`,前台问答组件一律用 `textContent` / `createElement` 构造 DOM。

- 用户可控内容进入 HTML 前必须转义(`src/utils/html.ts` 的 `escapeHtml`);需要保留富文本时走 `sanitizeAiPublicHtml` 白名单。
- 模型输出与数据库内容不进入 `innerHTML`,前台问答组件一律用 `textContent` / `createElement` 构造 DOM。

## 6. 日志清理与媒体压缩

### 6.1 日志自动清理 (`src/cron/logRetention.ts`)

每天 03:00(北京时间)执行一次全租户日志清理,通过 `wrangler.toml` 的 `[triggers]` cron 触发,使用 KV 锁避免重复执行,不影响 `*/5` 的新闻采集 cron:

| 表 | 保留策略 | 清理方式 |
|---|---|---|
| `rank_history` | 每个关键词最近 90 天快照 | 超期 `DELETE`,每个 keyword+engine 保留最新 1 行 |
| `ai_qa_messages` | 30 天前只保留 question/answer 摘要 | 超期 `UPDATE` 清空 session_key 等明细字段 |
| `collection_logs` | 180 天 | 超期 `DELETE` |
| `submit_logs` | 180 天 | 超期 `DELETE` |
| `review_logs` | 180 天 | 超期 `DELETE` |
| `daily_stats` | 365 天 | 按 `date` 列超期 `DELETE` |

清理结果持久化到 `CACHE_KV` 的 `log_retention:last_clean`,可在后台 `/admin/system` 查看上次清理时间与各表清理行数。

### 6.2 图片上传自动压缩 (`src/routes/admin/media.ts`)

- 仅 JPG/PNG/WEBP 且单文件超过 200KB 时尝试压缩;
- JPEG:quality 0.8、最大宽度 1600px; PNG:转 WebP(quality 0.8)、最大宽度 1600px;
- 微信二维码路径(`media/contact/`、`media/qr/`)不压缩,保持原样;
- 压缩优先使用 Cloudflare Workers `image_processing`(通过 `response.cf.image.edit`),若不可用则回退原样上传并打日志;
- `wrangler.toml` 已开启 `compatibility_flags = ["nodejs_compat", "image_processing"]`;
- `media_assets` 表增加 `original_size` / `stored_size` 两列,后台媒体库列表展示「原始大小 / 存储大小」,已压缩文件标记 `✓ 已压缩`。

### 6.3 CSRF 双保险机制 (`src/middleware/security.ts`、`src/templates/adminLayout.ts`)

为了防止跨站请求伪造(CSRF),系统采用双重保护:

| 层 | 机制 | 作用 |
|---|---|---|
| **服务端** | `ensureCsrfCookie` 中间件在 `next()` **之前**生成 CSRF Token 并写入 `Set-Cookie` 响应头,同时 `c.set('csrfToken', token)` 供路由模板读取 | 首次访问后台时,服务端即可将 CSRF Token 下发给浏览器,路由模板将其注入 `<meta name="csrf-token">` 和所有 `<form method="post">` 的隐藏字段 `_csrf` |
| **客户端** | 后台模板 `adminLayout.ts` 在 `<head>` 中输出 `<meta name="csrf-token">`,JS 优先从该标签读取 token,回退到 `document.cookie`;所有 `<form method="post">` 自动填入 `_csrf` 隐藏字段,所有 `fetch` POST 请求自动带 `X-CSRF-Token` 请求头 | 即使首次访问时 Cookie 尚未写入浏览器,表单也已携带正确 Token,避免 403 错误 |

两套机制必须同时匹配(服务端 Cookie 值 == 表单/请求头 Token),任意一条校验失败均返回 403。

## 7. 明确不做
- 统一日志:`safeError` / `safeWarn` / `safeInfo`(`src/utils/safeLogger.ts`),不打印密钥与 PII。
- `/healthz?probe=1` 汇报绑定状态与缺失的表。
- `/admin/system` 提供站内自检;`/admin/geo` 提供 AI 引用监测。

## 7. 明确不做

为避免范围蔓延,以下方向不纳入本仓库:

- 不引入第二套 Web 框架或全栈元框架(保持 Hono 单依赖);
- 不替换自研的 JWT / PBKDF2 认证体系;
- 不把 `articles` 改造成通用 documents 模型(版本历史以旁路快照表实现);
- 不内置计费/订阅模块(需要收费时由部署方自行对接支付渠道);
- 不引入浏览器端 E2E 体系,验证统一走 `node:test` + `scripts/check-*.mjs`。
