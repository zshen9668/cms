-- ============================================================================
-- 白标 CMS 基线种子数据（幂等）
-- ============================================================================
-- 全部使用 INSERT OR IGNORE / WHERE NOT EXISTS，重复执行不会覆盖站长已改的配置。
-- 本文件不写入任何城市、服务、关键词、文章或行业画像 —— 白标模板保持空白站点。
-- ============================================================================

-- 默认租户：单站部署时所有数据归属 tenant_id = 1。
INSERT OR IGNORE INTO tenants (id, slug, display_name, owner_email, tier, status)
VALUES (1, 'main', '', 'owner@example.com', 'free', 'active');

-- 套餐配额
INSERT OR IGNORE INTO tier_limits (tier, cities_max, articles_max, ai_generations_day, custom_domain, white_label)
VALUES ('free', 5, 50, 3, 0, 0);
INSERT OR IGNORE INTO tier_limits (tier, cities_max, articles_max, ai_generations_day, custom_domain, white_label)
VALUES ('basic', 50, 500, 100, 0, 0);
INSERT OR IGNORE INTO tier_limits (tier, cities_max, articles_max, ai_generations_day, custom_domain, white_label)
VALUES ('pro', 500, 5000, 1000, 1, 1);
INSERT OR IGNORE INTO tier_limits (tier, cities_max, articles_max, ai_generations_day, custom_domain, white_label)
VALUES ('enterprise', 5000, 50000, 10000, 1, 1);

-- 站点画像（留空，由后台设置或 starter 模板写入）
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('site_topic', 1, '');
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('site_industry', 1, '');
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('primary_services', 1, '');
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('primary_keywords', 1, '');
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('news_categories', 1, '');
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('industry_keywords', 1, '');

-- 初始化状态：pending（待初始化）/ installing（初始化中）/ installed（已完成）
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('seed_state', 1, 'pending');

-- 新闻采集默认关闭，由站长在后台显式开启
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('news_collection_enabled', 1, '0');

-- AI 采集内容质量门槛（0-100）
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('news_quality_min', 1, '65');

-- 页面级自定义设置容器
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('page_settings_json', 1, '');

-- GEO 辅助入口默认开启：/llms.txt 与 robots.txt 中的 AI 爬虫白名单
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('geo_llms_enabled', 1, '1');
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('geo_ai_crawlers_enabled', 1, '1');
