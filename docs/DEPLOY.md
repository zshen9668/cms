# 部署到 Cloudflare

白标 CMS 的部署指南。

## 一句话版本

```bash
npm run deploy
```

一条命令完成:环境自检 → 建资源 → 建库表 → 发布 Worker → 自检。

---

## 1. 部署脚本做了什么

`npm run deploy` 按顺序执行,任何一步失败都会立刻停下并说明原因,不会伪报成功:

| 步骤 | 内容 | 失败时 |
|---|---|---|
| 1 | 环境自检:Node 版本、必需文件、本地 wrangler | 直接报错退出,并说明缺什么 |
| 2 | 读取凭证:环境变量优先,其次项目根目录 `.dev.vars` | 没有凭证也继续,进入第 4 步 |
| 3 | 幂等创建/复用 D1、KV、R2 | 报错并提示 Token 权限不足 |
| 4 | 把资源 ID 注入 `.wrangler.deploy.toml` | — |
| 5 | 应用 `migrations/` 下全部 D1 迁移 | 报错并给出「怎么建资源」的指引 |
| 6 | `wrangler deploy` 发布 Worker | 列出常见原因(ID 为空 / R2 不存在 / 未开通 AI) |
| 7 | 访问 `/healthz?probe=1` 自检 | 打印 bindings 与 missing_tables,非 0 退出 |

## 2. 只有一个配置文件

仓库里只有一份 `wrangler.toml`,受版本控制且**不含任何账号专属 ID**。账号专属的 D1 `database_id` 与 KV `id` 由脚本写入 `.wrangler.deploy.toml`,该文件已加入 `.gitignore`——别人 clone 你的仓库时不会被绑到你的数据库上。

## 3. 本机一条命令(推荐)

### 前提

- Node.js 26.x(版本见 `.nvmrc`)
- 一个 Cloudflare 账号

### 步骤

```bash
npm ci
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`,填入两个值:

```bash
CLOUDFLARE_API_TOKEN=你的Token
CLOUDFLARE_ACCOUNT_ID=你的AccountID
```

```bash
npm run deploy
```

### 两个值从哪里来

| 值 | 获取方式 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → 右上角头像 → **My Profile** → **API Tokens** → **Create Token** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户主页右侧的 **Account ID** |

Token 权限勾选:

- **D1** → Write
- **Workers KV Storage** → Edit
- **Workers R2 Storage** → Edit
- **Workers Scripts** → Edit(需要通过 API 管理 Worker 时才需要)

自定义 Token 时请把账号范围限制为你自己的账号。

> `CLOUDFLARE_API_TOKEN` 是**构建/部署凭证**,不是网站访客的运行时密钥。
> 只放在 `.dev.vars`(本地)或 GitHub Secrets(CI),**绝不写进 `wrangler.toml`、源码或提交到仓库**。

### 不填 Token 可以吗

可以,前提是 Cloudflare 账号里已存在同名资源:

- D1:`white-label-cms-db`
- KV:`CACHE_KV`
- R2:`white-label-cms-r2-media`

Wrangler 会按 `wrangler.toml` 里的资源名解析绑定。首次部署建议填 Token,让脚本把资源一次建好。

## 4. 推到 GitHub 自动部署

适合不想在自己电脑上放 Token 的情况。

### 第 1 步:推送代码

```bash
git init
git add .
git commit -m "feat: initial commit of white-label cms"
git remote add origin https://github.com/<你的GitHub用户名>/white-label-cms.git
git branch -M main
git push -u origin main
```

### 第 2 步:配置 Secrets

GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret 名称 | 值 |
|---|---|
| `CF_API_TOKEN` | 你的 Cloudflare API Token |
| `CF_ACCOUNT_ID` | 你的 Cloudflare Account ID |

配置完成后进入 **Actions** 页签,对最近一次运行点 **Re-run all jobs**。

### 第 3 步:看结果

工作流有两个 job:

| Job | 何时运行 | 做什么 |
|---|---|---|
| **校验** | PR 与 push 都运行 | 类型检查、单元测试、仓库完整性、迁移命名与 schema 重放、路由快照、配置检查、`wrangler deploy --dry-run` |
| **部署** | 仅 push `main` 或手动触发 | `npm run deploy` |

## 5. 部署后:创建管理员

打开:

```text
https://你的项目.workers.dev/admin/setup
```

填写管理员邮箱和密码(至少 10 位、含两类字符)。

数据库结构已由 `npm run deploy` 在发布 Worker **之前**建好,不会出现「表不存在」的报错。若配置了 `SETUP_TOKEN`,表单会先要求输入该令牌。

### 部署后 3 步配置向导

完成管理员创建后,建议按顺序做这三步,把站点从「白标空壳」变成「可用站点」:

| 步骤 | 页面 | 做什么 |
|---|---|---|
| **1. 选行业模板** | `/admin/setup`(创建时) 或 `/admin/settings` | 选择行业预设(企业服务、本地家政、职业教育、健康体检、建筑装饰、法律 IP、环保检测、物流货运、软件 IT、汽车服务、餐饮食品、人力资源),自动写入行业画像、核心服务、行业关键词、新闻分类;同时生成城市×服务关键词矩阵并插入默认城市/服务 |
| **2. 配置 AI 通道** | `/admin/ai-settings` | 开启 Workers AI(免费层)或第三方 OpenAI 兼容 API;填 Base URL、模型名与 API Key;页内「运行诊断」验证可用后,AI 写作、智能问答、关键词生成即可使用 |
| **3. 配置推送密钥** | `/admin/system-secrets` | 填 IndexNow Key、百度 Token、360 Token、搜狗 Token、Google 服务账号 JSON 等;之后发布文章可后台一键通知搜索引擎抓取 |

完成这三步后,站点即具备:行业化内容、AI 写作能力、搜索引擎主动推送。

## 6. 可选:运行时 Secret

以下都不是部署必需的。推荐直接改在后台 `/admin/system-secrets`(加密入库,免重新部署);也可以用 Cloudflare Dashboard → 你的 Worker → **Settings** → **Variables and Secrets** 配置同名变量作为兜底。

| 配置 | 说明 | 必填 |
|---|---|---|
| `SETUP_TOKEN` | 保护 `/admin/setup` 与 `/admin/recover` | 推荐 |
| `JWT_SECRET` | 会话签名密钥;不填时自动在 `CACHE_KV` 生成并持久化 | 否 |
| `EXTERNAL_AI_API_KEY` | OpenAI 兼容的外部 AI API 密钥(不入库) | 否 |
| `RESEND_API_KEY` | Resend 事务邮件 | 否 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Indexing API 服务账号 JSON | 否 |
| `INDEXNOW_KEY` / `BAIDU_TOKEN` / `SO_TOKEN` / `SOGOU_TOKEN` | 搜索引擎推送密钥 | 否 |
| `WECHAT_WORK_*` | 企业微信接入 5 项(CorpID / AgentID / Secret / Token / AESKey) | 否 |

## 7. 绑定缺失会怎样

Worker 对缺失绑定是容错的,**不会启动即 500**:

| 绑定 | 缺失时表现 |
|---|---|
| `DB`(D1) | `/healthz` 返回 `ok:false`;所有查库路由 500 |
| `CACHE_KV` | 登录限流自动放行;JWT 密钥无法自动生成(可改用 `JWT_SECRET`) |
| `R2_MEDIA` | `/media/*` 返回 503,其余功能正常 |
| `AI` | AI 内容生成不可用,其余功能正常 |
| `ASSETS` | 静态资源与兜底路由不可用 |

`npm run deploy` 的自检只把 `DB`、`CACHE_KV`、`ASSETS` 当作必须项;R2 与 AI 缺失只打印提示。

## 8. 本地开发(不需要登录 Cloudflare)

```bash
npm ci
npm run dev
```

打开 http://127.0.0.1:8787 即可。D1 / KV / R2 / 静态资源全部在本地模拟运行,**不碰你的 Cloudflare 账号**。

首次使用需要建本地表:

```bash
npm run db:migrate:local
```

### 为什么 `npm run dev` 必须带 `--local`

`npm run dev` 实际执行 `wrangler dev --local`。

不带 `--local` 时,Wrangler 会把 `env.AI` 当作 **remote** 绑定,启动即尝试建立远程代理会话并要求 Cloudflare 登录授权;无浏览器可交互时会直接超时失败:

```text
⎔ Establishing remote connection...
X Failed to start the remote proxy session. Error reloading remote server:
  In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable ...
```

带上 `--local` 后绑定状态变成:

| 绑定 | 本地模式 |
|---|---|
| `DB` (D1) | local |
| `CACHE_KV` | local |
| `R2_MEDIA` | local |
| `ASSETS` | local |
| `AI` | **not supported**(本地不可用) |

`env.AI` 为 `not supported` 属正常现象:AI 内容生成在本地不可用,**站点其余功能完全正常**(`/healthz` 会把 AI 标为未绑定并继续工作)。

确实需要在本地调用 Workers AI 时:

```bash
npx wrangler login        # 完成一次浏览器授权
npm run dev -- --remote   # 走远程 AI,其余仍按配置
```

> **不要为了让本地跑起来而把 `wrangler.toml` 里的 `[ai]` 注释掉。** 那只是掩盖症状,并且会让**线上部署也失去 AI 绑定**。正确做法是保留 `[ai]`,本地用 `--local`。

## 9. 手动命令(一般不需要)

```bash
npm run setup:cloudflare                          # 只创建/复用资源并生成部署配置
npx wrangler deploy --dry-run --config wrangler.toml   # 干跑:只校验配置
npx wrangler d1 migrations apply DB --remote      # 只应用远程迁移
npm run doctor                                    # 部署前自检
npm run verify && npm run check:deployment && npm run check:schema
```

遇到问题见 [部署故障排查](CF-SETUP-TROUBLESHOOTING.md)。
