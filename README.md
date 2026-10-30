# 白标 CMS

基于 **Hono + Cloudflare Workers + D1** 的白标 SEO 营销系统。一套代码部署后，行业画像、页面文案、SEO 关键词、AI 提示词、统计脚本全部在后台配置，改一次、全站生效，无需重新部署。

多租户架构：`tenant_id` 共享库隔离 + `/t/{slug}` 路径识别，同一份代码可服务多个站点。

## 功能特性

| 特性 | 说明 |
|---|---|
| 可收录 | 动态 sitemap.xml、robots.txt、llms.txt、AI 爬虫白名单，面向搜索引擎与 AI 引擎 |
| GEO 引用 | JSON-LD 结构化数据（WebPage / Organization / Service / Article / FAQPage），AI 引擎可直接提取 |
| SEO 关键词 | 城市 × 服务关键词矩阵、页面级 SEO 标题/描述，支持站点默认 title/desc 模板占位符 |
| 一键配置 | 后台「设置」扩展「站点关联配置」，favicon / title 模板 / desc 模板 / llms.txt 内容 / 统计脚本 / CTA 开关，一次配置全站立即生效 |
| 获客转化 | CTA 悬浮区块、/contact 表单 + UTM 透传、AI 智能问答、企业微信自动回复 |
| 多租户 | `tenant_id` 隔离 + `/t/{slug}` 路径识别，一套代码多站点 |

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Cloudflare Workers |
| Web 框架 | Hono |
| 数据库 | D1（SQLite，`tenant_id` 多租户隔离） |
| 缓存 / 会话 | Workers KV |
| 对象存储 | R2 |
| 构建 / 部署 | wrangler |

## 快速开始

```bash
npm ci              # 安装依赖
npm run typecheck   # tsc --noEmit
npm test            # 单元测试（197 个）
npm run dev         # 本地开发（需 wrangler，Windows 可能 EFTYPE，环境问题非代码问题）
```

本地开发依赖 wrangler，`workerd` 在 Windows 上可能报 `spawn EFTYPE`。本地跑不通可跳过，直接走线上部署。

## 部署（Cloudflare 官方 Workers GitHub 集成）

1. 把代码推送到你的 GitHub 仓库。
2. Cloudflare Dashboard → **Workers & Pages** → **Import a repository** 选择该仓库。
3. 构建命令填 `npm run deploy`。该命令依次完成：

   ```
   环境自检 → 创建/复用 D1、KV、R2 → 资源 ID 写进 .wrangler.deploy.toml
   → 应用 migrations/ 全部迁移 → wrangler deploy → /healthz?probe=1 健康检查
   ```

4. 无需在构建里手填 Token；前提是 Cloudflare 账号已有同名资源（不存在则首次部署自动创建）。

本地开发也可用 `.dev.vars` 配置文件（见 `scripts/setup-cloudflare.mjs`）。涉及到的环境变量与密钥：

- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`：本地脚本（doctor、setup）调用 Cloudflare API 用
- `SETUP_TOKEN`：后台首次初始化 `/admin/setup` 的守护令牌（也可在后台「系统密钥 → 安全与登录」里配置，优先于环境变量）

### D1 资源清单

| 资源 | 名称 | 绑定名 |
|---|---|---|
| D1 | `white-label-cms-db` | `DB` |
| KV | `CACHE_KV` | `CACHE_KV` |
| R2 | `white-label-cms-r2-media` | `R2_MEDIA` |

## ⚠️ 推 GitHub 前必做（重要）

Cloudflare 构建命令是 `npm run build`，它**只做类型检查，不跑测试**——坏测试会被静默漏过。
所以在推送前，**本地必须跑一次完整校验**，全绿再推：

```bash
npm run validate:complete
```

这条命令覆盖 13 项仓库校验 + `typecheck` + 全部单元测试（197 个）：

| 校验项 | 作用 |
|---|---|
| `doctor` | 环境/依赖自检 |
| `verify` | 仓库完整性 |
| `check:schema` | 在内存 SQLite 上重放全部 D1 迁移，校验表结构 |
| `check:routes` | 后台路由快照比对（改路由后跑一次 `--update` 再 review 差异） |
| `check:public` | 前台路由与内部链接可达性 |
| `check:seo-geo` | SEO / GEO 合同（JSON-LD、llms.txt 等对外暴露面） |
| `check:deployment` | 部署配置一致性（单一 wrangler.toml、lockfile 入库、README 标记齐全） |
| `check:migrations` | 迁移文件名与编号规则 |
| `check:whitelabel` | 白标基线（禁止遗留行业内容与品牌） |
| `check:contact-fields` | 联系字段约定 |
| `check:plugins` | 插件 cron 接线 |
| `check:ai-qa` | 智能问答 / 企业微信 / 双语接线 |
| `check:admin-templates` | 后台模板模块结构 |

全部 exit 0 且 `npm test` 为 197/197 全绿，才可推送。

## 安全模型（多租户隔离）

本系统的安全设计要点（修改相关代码时务必遵守，否则会破坏多租户隔离）：

- **租户识别**：`/t/{slug}` 路径 → 查 `tenants` 表确认 slug 存在，**数据库查询失败时返回 500，绝不回退到默认租户**（防止跨租户数据访问）。见 `src/middleware/tenant.ts`。
- **数据读写**：所有读走 `scoped()`（自动给顶层 WHERE 注入 `tenant_id = ?`），写显式绑定 `tenant_id`；**不要拼接裸 SQL 的租户条件**。见 `src/db/scoped.ts`。
- **会话安全**：JWT 绑定密码哈希指纹（`src/middleware/authGuard.ts`），改密码即全端下线，无需额外迁移。
- **密码存储**：PBKDF2 600k 迭代（`src/utils/password.ts`），旧 SHA-256 哈希登录时自动升级；登录失败用 `DUMMY_PASSWORD_HASH` 抹平时序差异。
- **CSRF**：严格双提交（`src/middleware/security.ts`），明确拒绝「没有 token 就退回 Origin 检查」的降级分支。
- **路径遍历**：循环解码 + 字符白名单 + `path.posix.normalize` 三重（`src/utils/safePath.ts`）。
- **AI 输出**：走 `textContent`/`createElement`，不碰 `innerHTML`；富文本走标签白名单并丢弃全部属性。
- **SQL 注入**：全仓库参数化绑定，禁止把运行时值拼进 SQL 字符串。

### 子查询租户隔离（易踩坑）

`scoped()` **只给顶层 WHERE 注入 `tenant_id`**，子查询 / `EXISTS` 里的表不会被过滤。
任何出现在子查询中、又没手写租户条件的表（如 `keywords`、`cities`），可能把别的租户的数据带进结果。
写 JOIN 或子查询时，**每张表都要显式加 `tenant_id = ?` 并全部用表别名前缀限定列名**（避免 `ambiguous column name`）。

## 目录结构

| 目录 | 说明 |
|---|---|
| `src/routes/` | 公开与后台路由（`admin/` 为后台聚合） |
| `src/templates/` | HTML 模板（前台 + 后台，按导航分组拆分） |
| `src/utils/` | 工具函数：设置读写、SEO、安全日志、路径校验等 |
| `public/` | 静态资源（Workers Assets：CSS/JS/图标/sw.js） |
| `migrations/` | D1 迁移（只追加，不改名） |
| `scripts/` | 部署、验证、自检脚本 |
| `tests/` | Node 单元测试 |
| `docs/` | 部署、迁移与架构文档 |

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm ci` | 安装依赖 |
| `npm run typecheck` | `tsc --noEmit` 类型检查 |
| `npm test` | 运行单元测试（197 个） |
| `npm run validate:complete` | 13 项校验 + typecheck + 测试（**推 GitHub 前必跑**） |
| `npm run dev` | 本地开发（需 wrangler） |
| `npm run deploy` | 部署（创建/复用资源 + 迁移 + 发布 + 健康检查） |

## 贡献流程

贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 后续优化

- 抽 `getSiteName(settings, env)` 工具函数，合并 `src/routes/public.ts` 中约 15 处 `settings.site_name || env.SITE_NAME || '网站内容平台'` 的重复回退
- 抽 `setLangCookie(c, value, maxAge)` 工具函数，合并 `src/index.ts` 与 `src/routes/public.ts` 中重复的语言 Cookie 写入
- 抽 `pickLocale(page, locale, key)` 工具函数，合并 `src/routes/public.ts` 中多处 `page.titleZh : page.titleEn` 三元取值

本仓库遵循 `LICENSE`、`CONTRIBUTING.md` 与 `CHANGELOG.md`。
