-- 关键词排名追踪（移植自 seo-main「关键词排位雷达」的 SERP 排名跟踪模型）。
--
-- 背景：white-label-cms 原有「关键词矩阵」只做机会分打分（tier/服务权重/难度/搜索量），
-- 没有地方记录"某个关键词在某搜索引擎上的实际排名"。seo-main 的核心能力之一是
-- 跟踪每个关键词在 Google/Bing/百度上的当前排名、上次排名、变化值与 30 天历史。
-- 本次迁移把这套「排位雷达」数据模型并入 CMS，供后台「排名追踪」页读写。
--
-- 设计约定（与 0001 基线 / 0003 / 0005 保持一致）：
-- - 不加外键约束（D1 建表期外键在部分兼容场景会报错，历史上已统一去掉）。
-- - 文本字段一律 NOT NULL DEFAULT ''，避免渲染出 "null"。
-- - 整个文件幂等，可重复执行。
-- - 多租户：唯一约束与索引一律带 tenant_id 作用域；排名数据按"关键词+引擎"聚合同租户记录，
--   避免跨租户同名关键词互相串数据。

CREATE TABLE IF NOT EXISTS rank_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  keyword_id INTEGER NOT NULL DEFAULT 0, -- 关联 keywords.id（人工录入时为 0）
  keyword TEXT NOT NULL,
  search_engine TEXT NOT NULL DEFAULT '百度', -- 百度 / Google / Bing
  current_rank INTEGER NOT NULL DEFAULT 0, -- 0 表示未进前 100
  previous_rank INTEGER NOT NULL DEFAULT 0,
  search_volume INTEGER NOT NULL DEFAULT 0,
  difficulty TEXT NOT NULL DEFAULT '中',
  intent TEXT NOT NULL DEFAULT '信息查询', -- 信息查询 / 商业调研 / 交易购买 / 品牌导航
  target_url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  last_checked_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(keyword, search_engine, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_rank_tracking_tenant ON rank_tracking(tenant_id, keyword_id);
CREATE INDEX IF NOT EXISTS idx_rank_tracking_checked ON rank_tracking(tenant_id, last_checked_at DESC);

-- 排名历史快照：每次「拉取排名」按关键词+引擎追加一条，页面端最多展示最近 30 条。
CREATE TABLE IF NOT EXISTS rank_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  rank_tracking_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual', -- manual=人工回填 / probe=自动检测
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rank_history_item_date ON rank_history(rank_tracking_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_rank_history_tenant_date ON rank_history(tenant_id, date DESC);
