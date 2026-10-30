# SaaS 多租户设计

一套代码服务多个站点,每个租户有独立的数据与前台。

## 架构概览

| 维度 | 方案 |
|---|---|
| 数据隔离 | 共享一套 D1 + `tenant_id` 字段(Shared Schema) |
| 租户识别 | 路径模式 `/t/{slug}`(不依赖 Cloudflare for SaaS 或付费计划) |
| 计费 | 不内置计费模块;需要收费时由部署方自行对接支付渠道 |

---

## 1. 数据库

### 核心表

```sql
tenants(id, slug, display_name, owner_email, tier, status, trial_ends_at)
users(id, email, password_hash)
tenant_members(tenant_id, user_id, role)
tier_limits(tier, cities_max, articles_max, ai_generations_day, custom_domain, white_label)
```

- `tenants.tier`:`free` / `basic` / `pro` / `enterprise`
- `tenants.status`:`active` / `suspended`
- `tier_limits` 定义各档位配额上限,由 `migrations/0002_seed.sql` 写入

### 租户作用域

- 所有业务表带 `tenant_id INTEGER NOT NULL DEFAULT 1`,并有 `(tenant_id, ...)` 复合索引
- 单站部署时全部数据归属 `tenant_id = 1`,行为与单租户一致
- 唯一约束按租户作用域(例如 `cities` 是 `UNIQUE(slug, tenant_id)`),两个租户可以使用同名城市

---

## 2. 路由

### 租户中间件

`src/middleware/tenant.ts`

- 匹配 `/t/{slug}/...` → 查 `tenants` by slug(不存在返回 404)
- 注入 `c.set('tenant', { id, slug, tier, status })`
- 未命中路径前缀时回落到 1 号租户

### 租户 API

`src/routes/tenant.ts`

```text
POST /api/saas/tenants              # 创建租户 + owner 用户 + 成员关系(限流 5/60s)
POST /api/saas/tenants/:slug/login  # 邮箱 + 密码登录 → 返回 KV 会话 token(限流 10/60s)
GET  /api/saas/auth/me              # 当前租户与档位(Bearer 鉴权)
```

---

## 3. 关键抽象

### SettingsStore

`src/utils/settingsStore.ts`

```ts
SettingsStore.for(env).get('site_name')              // 默认租户(tenant_id = 1)
SettingsStore.forTenant(env, tenantId).get('site_name')  // 指定租户
```

- `get` / `getMany` / `getMap` / `batch` / `delete` 全部带租户维度
- 后台路由一律使用 `forTenant(env, getTenantId(c))`,避免写入落到 1 号租户

### 租户作用域查询

`src/db/scoped.ts` / `src/db/scopedDb.ts`

- `scoped()` 负责给查询注入 `tenant_id` 条件;业务代码不手写租户过滤
- `getTenantId(c)` 从请求上下文取当前租户

### 后台鉴权

`src/middleware/authGuard.ts` / `src/middleware/rbac.ts`

- 会话 JWT 携带 `{ uid, email, pwd }`;`requireAdmin` 校验账号仍存在、密码指纹未变
- 角色模块权限由 `requireRbac()` 校验,`/admin` 与 `/admin/modules/*` 使用同一套中间件

---

## 4. 相关文件

```text
migrations/0001_baseline.sql   # tenants / users / tenant_members / tier_limits 及全部业务表
migrations/0002_seed.sql       # 默认租户 + 各档位配额
src/middleware/tenant.ts       # 租户识别
src/routes/tenant.ts           # 租户 API
src/db/scoped.ts               # scoped() / getTenantId()
src/db/scopedDb.ts             # 租户作用域查询封装
src/utils/settingsStore.ts     # 设置读写租户化
src/plugins/rbac/              # 角色与后台模块权限
```

---

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 后台路由漏改租户作用域 → 跨租户串台 | 统一走 `scoped()`,禁止手写租户条件;`check:schema` 断言租户级唯一约束 |
| 单库数据量大后慢查询 | 已建 `(tenant_id, ...)` 复合索引;后续可按租户分片 |
| 租户识别依赖路径前缀,子域未支持 | 当前用 `/t/{slug}`,需要子域时再叠加自定义域 |
| 首个管理员初始化与租户创建的关系 | `/admin/setup` 创建的是平台管理员;租户经由 SaaS API 创建,自动带上 owner 成员关系 |

---

## 6. 验收标准

- 租户 A 的城市/文章/设置对租户 B 前后端均不可见
- 同一用户切换租户时数据各自独立
- `tier_limits` 按当前租户档位生效,后台可查看档位与配额
- `npm test` 与 `npm run validate:complete` 全绿
