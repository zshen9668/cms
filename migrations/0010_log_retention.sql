-- ============================================================================
-- 日志保留与自动清理索引（0010）
-- ============================================================================
-- 为日志类表添加 created_at（或 date）索引，供定时清理任务高效查询超期数据。
-- 全表采用 CREATE INDEX IF NOT EXISTS，幂等可重复执行。
-- ============================================================================

-- rank_history：按租户+日期查询历史快照，用于按 90 天保留清理
CREATE INDEX IF NOT EXISTS idx_rank_history_created_at
  ON rank_history(tenant_id, created_at DESC);

-- ai_qa_messages：已有 idx_ai_qa_messages_tenant_created，此处保险再建一份按租户+时间
CREATE INDEX IF NOT EXISTS idx_ai_qa_messages_created_at
  ON ai_qa_messages(tenant_id, created_at DESC);

-- collection_logs：已有索引，保险再建
CREATE INDEX IF NOT EXISTS idx_collection_logs_created_at
  ON collection_logs(tenant_id, created_at DESC);

-- submit_logs：已有索引，保险再建
CREATE INDEX IF NOT EXISTS idx_submit_logs_created_at
  ON submit_logs(tenant_id, created_at DESC);

-- review_logs：已有索引，保险再建
CREATE INDEX IF NOT EXISTS idx_review_logs_created_at
  ON review_logs(tenant_id, created_at DESC);

-- daily_stats：使用 date 作为主键已天然索引，无 created_at 列，此处不再重复建立
-- (daily_stats 表结构：date TEXT PRIMARY KEY, views, tenant_id)
