-- ============================================================================
-- 白标 CMS 统一基线 Schema（幂等）
-- ============================================================================
-- 本文件取代旧版 0001 ~ 0038 共 38 个增量迁移。
--
-- 为什么要合并：
--   旧迁移链存在"前向引用"——0017 删除 review_logs / collection_logs、0030 修改这两张表，
--   但它们直到 0036 才被创建。在全新 D1 上按 0001→0038 顺序执行时，会在 0017 抛
--   `no such table: review_logs`，导致 `wrangler d1 migrations apply` 中断、
--   d1_schema 失败、后台整站 500。这是两套 Cloudflare 部署方案的共同死因。
--   旧链另有 49 条无幂等保护的 `ALTER TABLE ADD COLUMN`（SQLite 不支持
--   ADD COLUMN IF NOT EXISTS），与 /admin/setup 的运行时建表互相冲突。
--
-- 设计原则：
--   1. 只使用 CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS —— 可重复执行。
--   2. 所有表直接建为最终形态，不再依赖 ALTER TABLE 叠加。
--   3. 本文件是 schema 的唯一真相源；src/routes/admin/auth.ts 不再自行建表。
--   4. settings 使用 (key, tenant_id) 复合主键，与 SettingsStore 的
--      `ON CONFLICT(key, tenant_id)` 一致。
--   5. 唯一约束一律带 tenant_id 作用域，保证多租户下两个租户可用同名城市/服务。
--      例外：keywords(city_id, service_id) 与 social_posts(article_id, platform)
--      必须保持原样，因为应用代码使用 `ON CONFLICT(<这两列>)` 做 upsert。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 多租户基础
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  owner_email TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  trial_ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tenants_owner ON tenants(owner_email);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS tenant_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER NOT NULL DEFAULT 1,
  role TEXT NOT NULL DEFAULT 'admin',
  UNIQUE(tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS tier_limits (
  tier TEXT PRIMARY KEY,
  cities_max INTEGER DEFAULT 10,
  articles_max INTEGER DEFAULT 100,
  ai_generations_day INTEGER DEFAULT 5,
  custom_domain INTEGER DEFAULT 0,
  white_label INTEGER DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- 2. 系统设置与管理账号
-- ---------------------------------------------------------------------------

-- 复合主键 (key, tenant_id)：SettingsStore 与 protectedSecrets 都依赖它做 upsert。
CREATE TABLE IF NOT EXISTS settings (
  key TEXT NOT NULL,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  value TEXT,
  PRIMARY KEY (key, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_settings_tenant ON settings(tenant_id);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 3. 内容主表：城市 / 服务 / 关键词矩阵
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  province TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  tier TEXT DEFAULT '二线',
  seo_title TEXT DEFAULT '',
  seo_description TEXT DEFAULT '',
  seo_keywords TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, tenant_id),
  UNIQUE(slug, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_cities_tenant_active ON cities(tenant_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_cities_active_sort ON cities(is_active, sort_order);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT,
  summary TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  demand_weight INTEGER DEFAULT 50,
  seo_title TEXT DEFAULT '',
  seo_description TEXT DEFAULT '',
  seo_keywords TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, tenant_id),
  UNIQUE(slug, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_services_tenant_active ON services(tenant_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_services_active_sort ON services(is_active, sort_order);

-- UNIQUE(city_id, service_id) 不可改动：newsCollector / shared.ts 使用
-- `ON CONFLICT(city_id, service_id) DO UPDATE`。city_id 本身已按租户隔离，故无需再加 tenant_id。
CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  city_id INTEGER REFERENCES cities(id),
  service_id INTEGER REFERENCES services(id),
  search_volume INTEGER DEFAULT 0,
  difficulty TEXT DEFAULT '中',
  opportunity_score INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  landing_slug TEXT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  city_weight INTEGER DEFAULT 0,
  service_weight INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(city_id, service_id)
);
CREATE INDEX IF NOT EXISTS idx_keywords_tenant_score ON keywords(tenant_id, opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_keywords_opportunity ON keywords(opportunity_score DESC);

-- ---------------------------------------------------------------------------
-- 4. 文章（含 AI 生成、微信排版、社交分发、人工审核、GEO 字段）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  category TEXT,
  city_id INTEGER REFERENCES cities(id),
  service_id INTEGER REFERENCES services(id),
  summary TEXT,
  content TEXT NOT NULL,
  source_url TEXT,
  source_name TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  credibility_score INTEGER DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'draft',
  cover_image TEXT,
  video_url TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  -- AI 质量评分与图解要点
  ai_score INTEGER DEFAULT 0,
  ai_score_breakdown TEXT DEFAULT NULL,
  slides_json TEXT,
  -- 微信公众号排版
  wechat_title TEXT,
  wechat_summary TEXT,
  wechat_cover_url TEXT,
  wechat_content TEXT,
  wechat_status TEXT DEFAULT 'not_synced',
  wechat_scheduled_at TEXT,
  wechat_synced_at TEXT,
  -- GEO：问答对（用于 FAQPage 结构化数据 + 前台可见问答区）
  faq_json TEXT DEFAULT '',
  -- 人工审核
  card_svg TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  reject_reason TEXT,
  -- 逐篇 SEO
  seo_title TEXT DEFAULT '',
  seo_description TEXT DEFAULT '',
  seo_keywords TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(slug, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_city ON articles(city_id);
CREATE INDEX IF NOT EXISTS idx_articles_service ON articles(service_id);
CREATE INDEX IF NOT EXISTS idx_articles_review ON articles(status, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source_url ON articles(source_url);
CREATE INDEX IF NOT EXISTS idx_articles_tenant_status_published ON articles(tenant_id, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_tenant_city ON articles(tenant_id, city_id);
CREATE INDEX IF NOT EXISTS idx_articles_tenant_service ON articles(tenant_id, service_id);

CREATE TABLE IF NOT EXISTS article_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  article_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  root_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  slug TEXT,
  category TEXT,
  summary TEXT,
  content TEXT,
  status TEXT NOT NULL,
  seo_title TEXT,
  seo_description TEXT,
  seo_keywords TEXT,
  card_svg TEXT,
  cover_image TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_article_versions_article ON article_versions(article_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_article_versions_tenant ON article_versions(tenant_id, article_id);

-- ---------------------------------------------------------------------------
-- 5. 采集来源 / 采集与审核日志
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS news_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  credibility TEXT DEFAULT '中',
  is_active INTEGER NOT NULL DEFAULT 1,
  last_fetched_at TEXT,
  tenant_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_news_sources_tenant_active ON news_sources(tenant_id, is_active, last_fetched_at);
CREATE INDEX IF NOT EXISTS idx_news_sources_active_last ON news_sources(is_active, last_fetched_at, id);

-- 旧迁移链把这两张表拖到 0036 才创建，是部署失败的直接原因；此处与其它表一同建立。
CREATE TABLE IF NOT EXISTS collection_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT,
  fetched_count INTEGER DEFAULT 0,
  created_count INTEGER DEFAULT 0,
  published_count INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_collection_logs_created ON collection_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_logs_tenant ON collection_logs(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS review_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  operator TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_review_logs_article ON review_logs(article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_logs_tenant ON review_logs(tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. 留言 / 回复 / 表单
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  phone TEXT,
  city TEXT,
  service TEXT,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id INTEGER NOT NULL DEFAULT 1,
  email TEXT DEFAULT '',
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_status ON messages(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_status_created ON messages(status, created_at DESC);

CREATE TABLE IF NOT EXISTS message_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT '内部记录',
  operator TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_message_replies_message_created ON message_replies(message_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_email_replies_message ON email_replies(message_id, created_at DESC);

CREATE TABLE IF NOT EXISTS form_schemas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  fields TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_form_schemas_tenant ON form_schemas(tenant_id, enabled);

CREATE TABLE IF NOT EXISTS form_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  form_id INTEGER NOT NULL,
  payload TEXT NOT NULL,
  ip_hash TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (form_id) REFERENCES form_schemas(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON form_submissions(form_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. 子项目（自定义栏目聚合）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS subprojects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  label_zh TEXT NOT NULL,
  label_en TEXT NOT NULL DEFAULT '',
  title_zh TEXT NOT NULL DEFAULT '',
  title_en TEXT NOT NULL DEFAULT '',
  subtitle_zh TEXT NOT NULL DEFAULT '',
  subtitle_en TEXT NOT NULL DEFAULT '',
  content_zh TEXT NOT NULL DEFAULT '',
  content_en TEXT NOT NULL DEFAULT '',
  seo_title_zh TEXT NOT NULL DEFAULT '',
  seo_title_en TEXT NOT NULL DEFAULT '',
  seo_description_zh TEXT NOT NULL DEFAULT '',
  seo_description_en TEXT NOT NULL DEFAULT '',
  seo_keywords_zh TEXT NOT NULL DEFAULT '',
  seo_keywords_en TEXT NOT NULL DEFAULT '',
  layout TEXT NOT NULL DEFAULT 'grid',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(section, slug, tenant_id),
  CHECK(section IN ('service','article','new','city')),
  CHECK(layout IN ('grid','list','feature'))
);
CREATE INDEX IF NOT EXISTS idx_subprojects_tenant_section ON subprojects(tenant_id, section, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_subprojects_section_active_sort ON subprojects(section, is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS subproject_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subproject_id INTEGER NOT NULL REFERENCES subprojects(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  UNIQUE(subproject_id, item_type, item_id),
  CHECK(item_type IN ('service','article','city'))
);
CREATE INDEX IF NOT EXISTS idx_subproject_items_project ON subproject_items(subproject_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_subproject_items_target ON subproject_items(item_type, item_id, subproject_id);

-- ---------------------------------------------------------------------------
-- 8. 媒体 / 社交分发 / 统计
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  original_size INTEGER DEFAULT 0,
  stored_size INTEGER DEFAULT 0,
  etag TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_media_assets_tenant_key ON media_assets(tenant_id, object_key);
CREATE INDEX IF NOT EXISTS idx_media_assets_uploaded_at ON media_assets(uploaded_at DESC);

-- UNIQUE(article_id, platform) 不可改动：articles.ts / socialSync.ts 使用
-- `ON CONFLICT(article_id, platform) DO UPDATE`。
CREATE TABLE IF NOT EXISTS social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  title TEXT,
  content TEXT,
  hashtags TEXT,
  cover_url TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_synced',
  scheduled_at TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id INTEGER NOT NULL DEFAULT 1,
  UNIQUE(article_id, platform)
);
CREATE INDEX IF NOT EXISTS idx_social_posts_article ON social_posts(article_id);

-- PRIMARY KEY(date) 不可改动：stats.ts 使用 `ON CONFLICT(date) DO UPDATE`。
CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  tenant_id INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS submit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engine TEXT NOT NULL,
  url TEXT NOT NULL,
  status_code INTEGER,
  response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_submit_logs_created ON submit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submit_logs_tenant ON submit_logs(tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 9. GEO 引用监测
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS geo_citations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL,
  mentioned INTEGER NOT NULL DEFAULT 0,
  cited_url TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  checked_on TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tenant_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_geo_citations_tenant_date ON geo_citations(tenant_id, checked_on);
CREATE INDEX IF NOT EXISTS idx_geo_citations_platform_date ON geo_citations(platform, checked_on);
CREATE INDEX IF NOT EXISTS idx_geo_citations_query ON geo_citations(query);

-- ---------------------------------------------------------------------------
-- 10. 计费 / RBAC / API Keys
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stripe_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  tenant_id INTEGER,
  payload TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_tenant ON stripe_events(tenant_id);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_tenant_name ON roles(tenant_id, name);

-- 只存 SHA-256 哈希 + 前 8 位前缀；明文密钥只在创建响应中出现一次，绝不落库。
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'read',
  expires_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
