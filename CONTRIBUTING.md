# 贡献指南

欢迎为 **白标 CMS** 提交 Bug 报告、功能建议或 Pull Request。请遵循开源社区的基本礼仪,尊重每一位参与者。

## 本地开发

```bash
git clone https://github.com/<你的用户名>/white-label-cms.git
cd white-label-cms
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

打开 http://127.0.0.1:8787。D1 / KV / R2 / 静态资源全部本地模拟,**不会访问你的 Cloudflare 账号**。首次使用需要建本地表:

```bash
npm run db:migrate:local
```

Node.js 版本以 `.nvmrc` 为准。

## 提交前必须通过

```bash
npm run validate:complete
```

这条命令覆盖:部署配置、仓库完整性、D1 迁移命名与 schema 重放、后台路由快照、前台路由与链接、SEO/GEO 合同、白标基线、联系字段、插件 cron、智能问答/企业微信/双语接线、后台模板结构、TypeScript 类型检查、单元测试。

单独运行某一项:

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | TypeScript 类型检查(strict) |
| `npm test` | 单元测试 |
| `npm run check:routes` | 后台路由快照(改动路由后加 `-- --update`) |
| `npm run check:schema` | 在内存 SQLite 上重放迁移 |
| `npm run check:migrations` | 迁移文件名与编号 |
| `npm run check:admin-templates` | 后台模板模块结构 |
| `npm run check:whitelabel` | 白标基线(禁止遗留行业内容与品牌) |

## 改代码的约定

**结构**

- 后台页面模板按导航分组放在 `src/templates/adminXxx.ts` 域模块,`src/templates/admin.ts` 只做转发导出。新增页面写进对应域模块,并在 `NAV_GROUPS` 里挂到某个分组——漏挂会导致「只有知道 URL 才进得去」。详见 [架构与扩展](docs/ARCHITECTURE.md)。
- 新增数据表:用新编号追加一个迁移文件,并同步 `scripts/check-schema.mjs` 的 `REQUIRED_TABLES` 与 `src/routes/admin/auth.ts` 的 `REQUIRED_SCHEMA_TABLES`。详见 [D1 迁移规范](docs/MIGRATIONS.md)。
- 新增运行时密钥:登记进 `src/utils/systemSecrets.ts`,后台「系统密钥」页会自动出现该字段。

**样式**

- 改 `public/styles.css` 后,把 `src/templates/assets.ts` 的 `STYLESHEET_VERSION` 升一位;不要在任何模板里硬编码 `/styles.css`(`check:deployment` 会报错)。

**安全**

- 所有后台路由默认经过 `requireAdmin`;公开写接口必须限流,并按需叠加 Turnstile。
- 用户可控内容进 HTML 前统一用 `src/utils/html.ts` 的 `escapeHtml`;需要保留富文本时走 `sanitizeAiPublicHtml`。
- 数据库读走 `scoped()`,写显式绑定 `tenant_id`;不要拼接裸 SQL 的租户条件。

**多文件协作型改动**

密钥、公开路由、挂载点、后台面板、模板任何一处漏接线,表现都是「功能静默失效」而不是报错。改动这类功能时请同时更新对应的 `scripts/check-*.mjs` 断言,让缺失的接线在 CI 里就暴露。

## 提交 Pull Request

1. 从 `main` 切出功能分支;
2. 提交信息说明改了什么、为什么;
3. PR 描述中写明:修复或新增的内容、是否已跑通 `npm run validate:complete`、是否有破坏性变更;
4. 等待校验 job 通过。

## 部署

参考 [部署指南](docs/DEPLOY.md)。简述:

1. 把代码推送到你的 GitHub 仓库;
2. 在 Cloudflare Dashboard → Workers & Pages → **Import a repository** 选择该仓库;
3. 构建命令 `npm run build`,部署命令 `npm run deploy`;
4. 部署完成后访问 `/admin/setup` 创建首个管理员。

> **不要**让 Cloudflare 自动为你生成第二个 GitHub/GitLab 仓库,直接使用你已有的仓库即可。

## 目录结构

```
src/            源代码(路由、模板、中间件、工具、插件、定时任务)
migrations/     D1 数据库迁移(只追加,不改名)
public/         静态资源(Workers Assets)
scripts/        部署、验证、自检脚本
tests/          Node 单元测试
docs/           部署、迁移与架构文档
```

## 免责声明

本项目为开源软件,按「原样」提供,不提供任何明示或暗示的担保。使用前请自行评估 Cloudflare Workers 免费/付费额度是否满足你的业务需求。
