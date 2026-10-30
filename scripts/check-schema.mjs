#!/usr/bin/env node
/**
 * schema 迁移校验：在内存 SQLite 上按文件名顺序重放 migrations/，验证
 *   1. 全新库能一次跑通（旧链在 0017 因前向引用 review_logs 中断，本脚本可拦截）
 *   2. 同一份迁移重复执行不报错（幂等）
 *   3. 关键表 / 关键列 / 关键唯一约束存在
 *   4. 应用代码依赖的 ON CONFLICT upsert 目标在库中成立
 *
 * 这是 `wrangler d1 migrations apply` 的本地等价物，无需 Cloudflare 账号即可验证。
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'migrations')

const errors = []
const fail = (msg) => errors.push(msg)

// --- 读取迁移文件 ---------------------------------------------------------

let files
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
} catch (e) {
  console.error(`无法读取 ${dir}: ${e.message}`)
  process.exit(1)
}

if (files.length === 0) {
  console.error('migrations/ 下没有任何 .sql 文件')
  process.exit(1)
}

// 编号唯一性：0001_baseline.sql 与 0001_init.sql 同时存在时必须报错
const seen = new Map()
for (const f of files) {
  const m = /^(\d{4})_/.exec(f)
  if (!m) { fail(`迁移文件名不符合 NNNN_name.sql 约定: ${f}`); continue }
  if (seen.has(m[1])) fail(`迁移编号 ${m[1]} 重复: ${seen.get(m[1])} 与 ${f}`)
  else seen.set(m[1], f)
}

// --- 重放迁移 -------------------------------------------------------------

function apply(db, label) {
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8')
    try {
      db.exec(sql)
    } catch (e) {
      fail(`[${label}] 应用 ${f} 失败: ${e.message}`)
      return false
    }
  }
  return true
}

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = ON')

const freshOk = apply(db, '全新库')
if (freshOk) {
  // 幂等：同一份迁移再来一遍必须同样成功
  apply(db, '重复执行')
}

// --- 断言：表与列 ---------------------------------------------------------

const REQUIRED_TABLES = [
  'tenants', 'users', 'tenant_members', 'tier_limits',
  'settings', 'admin_users',
  'cities', 'services', 'keywords',
  'articles', 'article_versions', 'cases',
  'news_sources', 'collection_logs', 'review_logs',
  'messages', 'message_replies', 'email_replies',
  'form_schemas', 'form_submissions',
  'subprojects', 'subproject_items',
  'media_assets', 'social_posts', 'daily_stats', 'submit_logs',
  'geo_citations', 'ai_crawler_hits', 'stripe_events', 'roles', 'api_keys',
  'ai_qa_messages', 'wecom_message_log',
]

const tableNames = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
)

for (const t of REQUIRED_TABLES) {
  if (!tableNames.has(t)) fail(`缺少表: ${t}`)
}

function columnsOf(table) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name))
  } catch {
    return new Set()
  }
}

// 每张业务表都必须有 tenant_id（多租户隔离的前提）
const TENANT_SCOPED = [
  'cities', 'services', 'keywords', 'articles', 'article_versions', 'cases',
  'news_sources', 'collection_logs', 'review_logs',
  'messages', 'message_replies', 'email_replies',
  'form_schemas', 'form_submissions',
  'subprojects', 'subproject_items',
  'media_assets', 'social_posts', 'daily_stats', 'submit_logs',
  'geo_citations', 'ai_crawler_hits', 'roles', 'api_keys',
  'ai_qa_messages', 'wecom_message_log',
]
for (const t of TENANT_SCOPED) {
  const cols = columnsOf(t)
  if (cols.size > 0 && !cols.has('tenant_id')) fail(`表 ${t} 缺少 tenant_id 列`)
}

// 关键列：这些曾因迁移缺失导致后台整站 "no such column" 500
const REQUIRED_COLUMNS = {
  articles: [
    'faq_json', 'ai_score', 'ai_score_breakdown', 'slides_json',
    'card_svg', 'reviewed_by', 'reviewed_at', 'reject_reason',
    'seo_title', 'seo_description', 'seo_keywords', 'service_id',
    'wechat_title', 'wechat_status',
  ],
  cities: ['tier', 'seo_title', 'seo_description', 'seo_keywords'],
  cases: [
    'client_name', 'slug', 'industry', 'service_name', 'region',
    'summary', 'challenge', 'solution', 'results', 'testimonial',
    'content', 'cover_image_url', 'project_url',
    'is_featured', 'is_active', 'sort_order',
    'seo_title', 'seo_description', 'seo_keywords',
  ],
  services: ['demand_weight', 'seo_title', 'seo_description', 'seo_keywords'],
  keywords: ['city_weight', 'service_weight', 'note'],
  message_replies: ['channel', 'operator'],
  social_posts: ['cover_url', 'ai_generated', 'scheduled_at', 'synced_at'],
  messages: ['email'],
  // 智能问答/企业微信：应用代码依赖这些列（见 src/utils/aiQa.ts、src/routes/wecom.ts）
  ai_qa_messages: ['channel', 'locale', 'question', 'answer', 'sources_json', 'model', 'status', 'msg_id'],
  wecom_message_log: ['direction', 'msg_id', 'msg_type', 'from_user', 'agent_id', 'status'],
}
for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
  const have = columnsOf(table)
  for (const c of cols) {
    if (!have.has(c)) fail(`表 ${table} 缺少列: ${c}`)
  }
}

// --- 断言：应用代码依赖的 upsert 目标 -------------------------------------

function seedTenant() {
  db.exec("INSERT OR IGNORE INTO tenants (id, slug, owner_email) VALUES (1, 'main', 'owner@example.com')")
  db.exec("INSERT OR IGNORE INTO tenants (id, slug, owner_email) VALUES (2, 'second', 'o@example.com')")
}

if (tableNames.has('tenants')) {
  seedTenant()
  // 部分表带外键（keywords.city_id → cities.id、social_posts.article_id → articles.id），
  // 先建父行，否则 upsert 断言会被 FOREIGN KEY constraint failed 掩盖真实结论。
  db.exec("INSERT OR IGNORE INTO cities (id, name, slug, tenant_id) VALUES (1, '测试市', 'probe-city', 1)")
  db.exec("INSERT OR IGNORE INTO services (id, name, slug, tenant_id) VALUES (1, '测试服务', 'probe-service', 1)")
  db.exec("INSERT OR IGNORE INTO articles (id, title, slug, content, tenant_id) VALUES (1, '测试文章', 'probe-article', 'x', 1)")
}

const UPSERT_CASES = [
  {
    label: 'settings ON CONFLICT(key, tenant_id)',
    sql: "INSERT INTO settings (key, value, tenant_id) VALUES ('probe_key', 'a', 1) ON CONFLICT(key, tenant_id) DO UPDATE SET value = excluded.value",
    deps: ['settings'],
  },
  {
    label: 'keywords ON CONFLICT(city_id, service_id)',
    sql: "INSERT INTO keywords (keyword, city_id, service_id, tenant_id) VALUES ('k', 1, 1, 1) ON CONFLICT(city_id, service_id) DO UPDATE SET keyword = excluded.keyword",
    deps: ['keywords', 'cities', 'services'],
  },
  {
    label: 'social_posts ON CONFLICT(article_id, platform)',
    sql: "INSERT INTO social_posts (article_id, platform, title) VALUES (1, 'douyin', 't') ON CONFLICT(article_id, platform) DO UPDATE SET title = excluded.title",
    deps: ['social_posts'],
  },
  {
    label: 'daily_stats ON CONFLICT(date)',
    sql: "INSERT INTO daily_stats (date, views) VALUES ('2026-01-01', 1) ON CONFLICT(date) DO UPDATE SET views = views + 1",
    deps: ['daily_stats'],
  },
  {
    label: 'ai_crawler_hits ON CONFLICT(hit_date, bot, tenant_id)',
    sql: "INSERT INTO ai_crawler_hits (tenant_id, hit_date, bot, hits, last_path) VALUES (1, '2026-01-01', 'GPTBot', 1, '/') ON CONFLICT(hit_date, bot, tenant_id) DO UPDATE SET hits = ai_crawler_hits.hits + 1",
    deps: ['ai_crawler_hits'],
  },
]
for (const c of UPSERT_CASES) {
  if (!c.deps.every((t) => tableNames.has(t))) continue
  try {
    db.exec(c.sql)
    db.exec(c.sql) // 第二次必须走 DO UPDATE 分支而不是报错
  } catch (e) {
    fail(`upsert 目标缺失 —— ${c.label}: ${e.message}`)
  }
}

// --- 断言：复合唯一约束（多租户下同名城市/服务可共存） ---------------------

if (tableNames.has('cities')) {
  try {
    db.exec("INSERT INTO cities (name, slug, province, tenant_id) VALUES ('深圳', 'shenzhen', '广东省', 1)")
    db.exec("INSERT INTO cities (name, slug, province, tenant_id) VALUES ('深圳', 'shenzhen', '广东省', 2)")
    db.exec("INSERT OR IGNORE INTO tenants (id, slug, owner_email) VALUES (2, 'second', 'o@example.com')")
  } catch (e) {
    fail(`cities 唯一约束未按租户作用域 —— 两个租户无法使用同名城市: ${e.message}`)
  }
}

if (tableNames.has('cases')) {
  try {
    db.exec("INSERT INTO cases (slug, client_name, tenant_id) VALUES ('probe-case', '客户A', 1)")
    db.exec("INSERT INTO cases (slug, client_name, tenant_id) VALUES ('probe-case', '客户B', 2)")
    let rejected = false
    try {
      db.exec("INSERT INTO cases (slug, client_name, tenant_id) VALUES ('probe-case', '客户C', 1)")
    } catch {
      rejected = true
    }
    if (!rejected) fail('cases 未拦截同一租户内的重复 slug')
  } catch (e) {
    fail(`cases 唯一约束未按租户作用域 —— 两个租户无法使用相同 slug: ${e.message}`)
  }
}

// --- 智能问答 / 企业微信：MsgId 去重与部分唯一索引 -------------------------
// 企业微信在客户端未及时收到响应时会重复推送同一条消息。去重靠
// (msg_id, tenant_id) 的部分唯一索引；msg_id 为空的 Web 端问答不能被它误伤。
if (tableNames.has('ai_qa_messages')) {
  try {
    db.exec("INSERT OR IGNORE INTO ai_qa_messages (tenant_id, channel, msg_id, question) VALUES (1, 'wecom', 'MSG-DUP', 'q1')")
    db.exec("INSERT OR IGNORE INTO ai_qa_messages (tenant_id, channel, msg_id, question) VALUES (1, 'wecom', 'MSG-DUP', 'q2')")
    const dup = db.prepare("SELECT COUNT(*) AS n FROM ai_qa_messages WHERE msg_id = 'MSG-DUP' AND tenant_id = 1").get()
    if (Number(dup?.n || 0) !== 1) fail('ai_qa_messages 未按 (msg_id, tenant_id) 去重 —— 企业微信重复推送会被重复记录')

    db.exec("INSERT OR IGNORE INTO ai_qa_messages (tenant_id, channel, msg_id, question) VALUES (1, 'web', '', 'w1')")
    db.exec("INSERT OR IGNORE INTO ai_qa_messages (tenant_id, channel, msg_id, question) VALUES (1, 'web', '', 'w2')")
    const web = db.prepare("SELECT COUNT(*) AS n FROM ai_qa_messages WHERE channel = 'web' AND tenant_id = 1").get()
    if (Number(web?.n || 0) !== 2) fail('ai_qa_messages 的部分唯一索引误伤了 msg_id 为空的 Web 问答')
  } catch (e) {
    fail(`ai_qa_messages 去重约束校验失败: ${e.message}`)
  }
}

if (tableNames.has('settings') && tableNames.has('admin_users')) {
  try {
    db.exec("INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('seed_state', 1, 'pending')")
    const row = db.prepare("SELECT value FROM settings WHERE key = 'seed_state' AND tenant_id = 1").get()
    if (!row) fail('种子数据 seed_state 未写入')
  } catch (e) {
    fail(`种子数据读取失败: ${e.message}`)
  }
}

// --- 结果 -----------------------------------------------------------------

if (errors.length > 0) {
  console.error(`\nschema 校验失败（${errors.length} 项）：`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

console.log(`schema 校验通过：${files.length} 个迁移文件、${tableNames.size} 张表、幂等重放 OK、upsert 目标与租户作用域唯一约束 OK`)
