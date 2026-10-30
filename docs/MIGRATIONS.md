# D1 迁移规范

## 迁移文件

`migrations/` 下共 8 个文件,按文件名顺序执行:

| 文件 | 作用 |
|---|---|
| `0001_baseline.sql` | 完整基线 schema:全部表、列与索引,一律 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` |
| `0002_seed.sql` | 幂等种子数据:默认租户、套餐配额、默认 settings。**不写入城市/服务/文章**,白标模板保持空白站点 |
| `0003_ai_crawler_hits.sql` | AI 爬虫访问统计表 |
| `0004_cases.sql` | 成功案例表(前台 `/case` 列表与详情) |
| `0005_ai_qa_wecom.sql` | 智能问答留痕 `ai_qa_messages`、企业微信收发留痕 `wecom_message_log` |
| `0006_seo_rank_track.sql` | 关键词排位追踪 `rank_tracks` / `rank_history` |
| `0007_ai_qa_sessions.sql` | 问答会话聚合列 `ai_qa_messages.session_key` / `session_title` |
| `0008_industry_settings.sql` | 行业与业务画像 settings 默认值(幂等 `INSERT OR IGNORE`) |
| `0009_preset_templates.sql` | 行业预设模板表 `preset_templates`,内置 12 个预设,首次部署写入 |
| `0010_log_retention.sql` | 日志类表保留索引:rank_history/ai_qa_messages/collection_logs/submit_logs/review_logs/daily_stats 的 created_at/date 索引,供定时清理查询 |

**核心约定**

1. **新增表**用新编号追加一个迁移文件;**给已有表加列**把列补进 `0001_baseline.sql`,不要用 `ALTER TABLE`。
2. 数据库结构的唯一真相源就是 `migrations/`。运行时不会自建表——`/admin/setup` 只校验表是否齐全,缺失时给出执行迁移的指引。

## 怎么运行

```bash
npm run deploy            # 部署时自动应用(推荐)
npm run db:migrate:remote # 只补远程库结构
npm run db:migrate:local  # 本地开发库
```

## 校验

```bash
npm run check:schema      # 在内存 SQLite 上重放迁移,验证幂等性与约束
npm run check:migrations  # 校验文件名、编号连续性与唯一性
```

`check:schema` 是 `wrangler d1 migrations apply` 的本地等价物,不需要 Cloudflare 账号。它验证:

1. **全新库能一次跑通**——引用尚不存在的表会在此拦住;
2. **同一份迁移重复执行不报错**——幂等性;
3. **必需表与关键列存在**——`scripts/check-schema.mjs` 断言 33 张表,`src/routes/admin/auth.ts` 的 `REQUIRED_SCHEMA_TABLES` 断言 30 张;
4. **应用代码依赖的 `ON CONFLICT` 目标在库中成立**;
5. **唯一约束按租户作用域**——两个租户可以使用同名城市;
6. **企业微信重推去重生效且不误伤**——`(msg_id, tenant_id)` 部分唯一索引能挡住重复 MsgId,同时不限制 `msg_id` 为空的 Web 端问答。

## 写新迁移的规则

1. **编号接在现有最大编号之后**(当前最大是 `0010`)。**不得重命名或重新编号已有文件**:D1 按文件名记录已执行的迁移,改名会让已部署站点重复执行。
2. **必须幂等**。建表用 `CREATE TABLE IF NOT EXISTS`,建索引用 `CREATE INDEX IF NOT EXISTS`,写数据用 `INSERT OR IGNORE`。
3. **加列不要用 `ALTER TABLE ADD COLUMN`**。SQLite 没有 `IF NOT EXISTS` 版本,重复执行会报 `duplicate column name`。给已有表加列时,直接把列写进 `0001_baseline.sql` 的建表语句——该文件完全幂等,可安全重复执行。
4. **不要引用后面才创建的表**。迁移按编号顺序执行,引用尚不存在的表会中断整条链。
5. **加表后同步更新校验**:把表名加进 `scripts/check-schema.mjs` 的 `REQUIRED_TABLES`(租户级业务表再加进 `TENANT_SCOPED`),并加进 `src/routes/admin/auth.ts` 的 `REQUIRED_SCHEMA_TABLES`。
6. 改完跑 `npm test && npm run validate:complete`。

## 唯一约束速查

| 表 | 约束 | 为什么是这个形状 |
|---|---|---|
| `settings` | `PRIMARY KEY (key, tenant_id)` | `SettingsStore` 与 `protectedSecrets` 使用 `ON CONFLICT(key, tenant_id)` |
| `keywords` | `UNIQUE(city_id, service_id)` | `newsCollector`、`shared.ts` 使用 `ON CONFLICT(city_id, service_id)` |
| `social_posts` | `UNIQUE(article_id, platform)` | `articles.ts`、`socialSync.ts` 使用 `ON CONFLICT(article_id, platform)` |
| `daily_stats` | `PRIMARY KEY (date)` | `stats.ts` 使用 `ON CONFLICT(date)` |
| `cities` | `UNIQUE(name, tenant_id)`、`UNIQUE(slug, tenant_id)` | 多租户下两个租户可用同名城市 |
| `articles` | `UNIQUE(slug, tenant_id)` | 同上;所有查询都经 `scoped()` 注入 `tenant_id` |
| `cases` | `UNIQUE(slug, tenant_id)` | 案例详情页按 slug 取数,租户内唯一 |
| `subprojects` | `UNIQUE(section, slug, tenant_id)` | 后台按 `section + tenant + slug` 判重 |
| `ai_crawler_hits` | `UNIQUE(hit_date, bot, tenant_id)` | 中间件用 `ON CONFLICT(...) DO UPDATE SET hits = hits + 1` 做当天计数累加 |
| `ai_qa_messages` | `UNIQUE INDEX (msg_id, tenant_id) WHERE msg_id <> ''` | **部分**唯一索引:企业微信会对同一条消息重推三次,靠它 + `INSERT OR IGNORE` 去重;`WHERE msg_id <> ''` 让 Web 端问答不受限制 |
| `ai_qa_messages` | `PRIMARY KEY (id)` | 问答记录只追加、不 upsert,因此没有 `ON CONFLICT` 目标 |

> **改约束前先搜一遍代码**:`grep -rn "ON CONFLICT" src/`。约束形状必须与代码里的 upsert 目标完全一致,否则运行时报 `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`。

## 常见报错

| 报错 | 原因 | 处理 |
|---|---|---|
| `no such table: xxx` | 迁移未应用 | `npm run deploy` 或 `npx wrangler d1 migrations apply DB --remote` |
| `duplicate column name: xxx` | 迁移不可重跑 | 不要用 `ALTER TABLE ADD COLUMN`,把列并入 `0001_baseline.sql` |
| `table cities has no column named tier` | 库是旧结构 | 重建 D1 后重新 `npm run deploy` |
| `ON CONFLICT clause does not match...` | 唯一约束与代码不一致 | 按上面的速查表修约束 |
| `D1_ERROR: Wrong number of parameter bindings` | SQL 占位符与 `.bind()` 数量不匹配 | 检查动态拼接 WHERE 的分支 |
