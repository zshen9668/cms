-- 成功案例（Case Studies）
--
-- 定位：前台首页原「服务城市」位置改为「成功案例」，用真实交付结果建立信任。
-- 城市页 /city/... 保持不变——它是本地 SEO / GEO 收录的载体，
-- 关键词矩阵的「城市 × 服务」组合也依赖 cities 表，不能删除。
--
-- 设计约定（与 cities 表保持一致，便于统一维护）：
-- - 不加外键约束：D1 建表期外键在部分兼容场景会报错，历史上已统一去掉；
--   案例与服务/城市只做逻辑关联，删掉服务不会牵连已发布的案例。
-- - 文本字段一律 NOT NULL DEFAULT ''，避免前台渲染出 "null"。
-- - 整个文件幂等，可重复执行。
-- - 多租户：(slug, tenant_id) 唯一，查询一律带 tenant_id。

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  -- 客户名称（可脱敏，例如「深圳某连锁餐饮企业」）
  client_name TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL,
  -- 所属行业
  industry TEXT NOT NULL DEFAULT '',
  -- 采用的服务（逻辑关联 services.name，不设外键）
  service_name TEXT NOT NULL DEFAULT '',
  -- 服务地区（逻辑关联 cities.name，不设外键；留空表示不限定地区）
  region TEXT NOT NULL DEFAULT '',
  -- 一句话摘要，用于列表卡片与 meta description 兜底
  summary TEXT NOT NULL DEFAULT '',
  -- 项目挑战
  challenge TEXT NOT NULL DEFAULT '',
  -- 解决方案
  solution TEXT NOT NULL DEFAULT '',
  -- 成果数据，一行一条，例如「上线 3 个月收录 120 页」
  results TEXT NOT NULL DEFAULT '',
  -- 客户评价
  testimonial TEXT NOT NULL DEFAULT '',
  -- 正文（补充叙述，富文本）
  content TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT NOT NULL DEFAULT '',
  project_url TEXT NOT NULL DEFAULT '',
  -- 首页「成功案例」模块优先展示精选案例
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  seo_keywords TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(slug, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_cases_tenant_active ON cases(tenant_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_cases_tenant_featured ON cases(tenant_id, is_featured, sort_order);
