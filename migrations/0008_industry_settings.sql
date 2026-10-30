-- ============================================================================
-- 白标 CMS 行业配置种子数据（幂等）
-- ============================================================================
-- 在 settings 表中新增行业相关配置项，全部使用 INSERT OR IGNORE，
-- 重复执行不会覆盖站长已改的配置。
-- 新增字段：
--   industry_type     行业类型（用于 AI 提示词与 SEO 模板）
--   industry_keywords 行业关键词（自动进入 SEO 与 AI 提示词）
--   target_customers  目标客户人群
--   service_features  服务特色 / 核心优势
--   application_scenarios 适用场景
-- ============================================================================

INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('industry_type', 1, '');
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('industry_keywords', 1, '');
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('target_customers', 1, '');
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('service_features', 1, '');
INSERT OR IGNORE INTO settings (key, tenant_id, value) VALUES ('application_scenarios', 1, '');
