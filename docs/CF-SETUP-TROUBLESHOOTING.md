# Cloudflare 部署故障排查

先跑这两个命令,多数问题会直接说明原因:

```bash
npm run doctor
npm run deploy
```

## 按症状查

| 症状 | 原因 | 处理 |
|---|---|---|
| `npm run dev` 卡在 `Establishing remote connection...` 然后报 `Failed to start the remote proxy session` | `wrangler dev` 不带 `--local` 时会把 `env.AI` 当作 remote 绑定,启动就要求 Cloudflare 登录授权 | `npm run dev` 已内置 `--local`;手敲 `npx wrangler dev` 时请补上 `--local` |
| 报 `Timed out waiting for authorization code` | 授权流程需要浏览器交互,无交互环境会超时 | 同上,用 `--local` 纯本地运行;或先 `npx wrangler login` 再 `npm run dev -- --remote` |
| 本地 `/healthz` 显示 `"AI": false` | 本地模式下 `env.AI` 为 `not supported`,属正常 | 无需处理,AI 功能只在部署后生效 |
| `npm run deploy` 报「未找到本地 wrangler」 | 依赖没装 | `npm install` |
| 报缺少 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`,随后迁移或发布失败 | 账号里没有同名资源,又没有凭证去创建 | 在项目根目录创建 `.dev.vars` 填入两个值,重跑 `npm run deploy` |
| `Authentication error` / `10000` | Token 无效、过期或账号范围不对 | 重新创建 Token,确认账号范围包含目标账号 |
| `Unable to create D1 database` / KV / R2 权限错误 | Token 权限不足 | 勾选 D1 **Write**、Workers KV Storage **Edit**、Workers R2 Storage **Edit** |
| `database_id is required` | `wrangler.toml` 里没有 ID,`.wrangler.deploy.toml` 也没生成 | 正常路径下脚本会生成它;若手动跑了 `wrangler deploy`,请改用 `npm run deploy` |
| `R2 bucket not found` | bucket 不存在 | 填好 Token 让脚本创建,或到 Cloudflare 控制台 R2 页手动创建 `white-label-cms-r2-media` |
| `no such table` / 后台整站 500 | 迁移没应用 | `npm run deploy`,或 `npx wrangler d1 migrations apply DB --remote` |
| 打开 `/admin/setup` 显示「数据库结构未初始化」 | D1 已绑定但业务表未建 | 执行 `npm run deploy`,或 `npx wrangler d1 migrations apply DB --remote`,然后刷新页面 |
| `/admin/setup` 显示「D1 数据库未绑定」 | `DB` binding 缺失 | 检查 `wrangler.toml` 的 `[[d1_databases]]` 段,重新 `npm run deploy` |
| 部署成功但 `/healthz` 的 `ok` 是 `false` | 某个 binding 缺失 | 看 `/healthz` 返回的 `bindings` 与 `missing_tables`,对照下表 |
| Actions 在 `npm ci` 就失败 | 仓库里没有 `package-lock.json` | lockfile 必须提交;`.gitignore` 不得忽略它 |
| Actions 报 `setup-node` 找不到版本 | `.nvmrc` 与 runner 不匹配 | 工作流使用 `node-version-file: .nvmrc`,保持 `.nvmrc` 为 `26.10.0` |
| 部署报「未开通 AI」 | 账号没有 Workers AI | 在 Cloudflare 开通 Workers AI;或从 `wrangler.toml` 删掉 `[ai]` 段,改用外部 OpenAI 兼容通道 |

## `/healthz` 返回值怎么读

```bash
curl https://你的项目.workers.dev/healthz?probe=1
```

```json
{
  "ok": true,
  "bindings": { "DB": true, "CACHE_KV": true, "R2_MEDIA": true, "AI": true, "ASSETS": true },
  "d1_schema": true,
  "missing_tables": []
}
```

| 字段 | 含义 |
|---|---|
| `bindings` | 各绑定是否可用。`DB`、`CACHE_KV`、`ASSETS` 缺失算致命;`R2_MEDIA`、`AI` 缺失只影响对应功能 |
| `d1_schema` | 业务表是否齐全。`false` 说明迁移没应用 |
| `missing_tables` | 具体缺哪些表,直接对应要建的迁移 |

## 绑定缺失的影响

| 绑定 | 缺失时 |
|---|---|
| `DB` | 所有查库路由 500 |
| `CACHE_KV` | 登录限流放行;JWT 密钥无法自动生成(可改用 `JWT_SECRET`) |
| `R2_MEDIA` | `/media/*` 返回 503,其余正常 |
| `AI` | AI 内容生成不可用,其余正常 |
| `ASSETS` | 静态资源与兜底路由不可用 |

> 账号无法开通 Workers AI 时,可以从 `wrangler.toml` 删掉 `[ai]` 段:AI 功能会整体降级关闭,站点其余功能不受影响。若仍需要 AI,可改在 `/admin/ai-settings` 使用外部 OpenAI 兼容通道。

## 迁移相关

见 [D1 迁移规范](MIGRATIONS.md)。

快速判断:

```bash
npm run check:schema      # 本地重放迁移,不需要 Cloudflare 账号
npm run check:migrations  # 文件名与编号
```

`check:schema` 能在本机复现「全新库跑不通迁移」这类问题,是排查部署失败的第一站。

## Token 应该放在哪里

| 场景 | 放哪里 |
|---|---|
| 本机部署 | 项目根目录 `.dev.vars`(已在 `.gitignore`) |
| GitHub Actions | 仓库 Settings → Secrets and variables → Actions → `CF_API_TOKEN`、`CF_ACCOUNT_ID` |

**不要**放进 `wrangler.toml`、源码、`.dev.vars.example` 或提交到仓库。

注意区分两类密钥:

- `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN` —— **构建/部署**凭证,只在部署期间使用;
- `SETUP_TOKEN` / `JWT_SECRET` / 企业微信 5 项 / 推送 Token —— **运行时**密钥,配在后台 `/admin/system-secrets`(推荐,加密入库)或 Worker 的 Settings → Variables and Secrets。

## 还是不行

```bash
npm run validate:complete
```

这条命令跑完本地全套校验(类型、测试、仓库完整性、迁移命名与 schema 重放、路由快照、配置检查),能定位绝大多数配置类问题。把输出贴出来即可。
