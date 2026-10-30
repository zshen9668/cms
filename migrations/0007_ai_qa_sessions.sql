-- 智能问答会话化（前台聊天界面 + 后台会话管理共用同一张表）。
--
-- 背景：white-label-cms 已整合 seo-main 的 GEO / 引用监测能力，问答链路
-- （前台右下角组件、企业微信回调）共用 ai_qa_messages 留痕，但旧表只有一条条
-- 「问题→答案」记录，没有会话概念：
--   - 前台访客每次问答都是孤立气泡，无法继续追问；
--   - 后台「智能问答」只能看流水日志，无法按会话管理。
-- 本次给 ai_qa_messages 增加 session_key（会话分组）与 session_title（会话首问标题），
-- 前台按 session_key 连续加载上下文，后台按会话聚合做「聊天管理」。
--
-- 设计约定（与 0001 基线一致：禁止 ALTER TABLE ADD COLUMN —— SQLite 不支持
-- ADD COLUMN IF NOT EXISTS，且 check-schema 要求整个迁移可重复执行）：
-- 用「重建表 + 数据搬运」实现加列，全程幂等，可安全重放。
-- 索引一律在重命名之后按最终表名创建：若在临时表上建索引，重放时
-- `CREATE INDEX IF NOT EXISTS` 会因同名索引已存在而跳过，最终表会静默丢索引。
-- 文本字段一律 NOT NULL DEFAULT ''，避免渲染出 "null"；多租户作用域不变。

CREATE TABLE IF NOT EXISTS ai_qa_messages_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL DEFAULT 'web',
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  question TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL DEFAULT '',
  sources_json TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'answered',
  error TEXT NOT NULL DEFAULT '',
  msg_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  session_key TEXT NOT NULL DEFAULT '',
  session_title TEXT NOT NULL DEFAULT ''
);

-- 搬运旧数据（仅当新表为空时搬，保证重放幂等）。
-- 显式列出列名：重放时 ai_qa_messages 已含 session_key，显式列名两边都成立。
INSERT INTO ai_qa_messages_new (
  id, tenant_id, channel, locale, question, answer, sources_json,
  model, latency_ms, ip_hash, status, error, msg_id, created_at
)
SELECT
  id, tenant_id, channel, locale, question, answer, sources_json,
  model, latency_ms, ip_hash, status, error, msg_id, created_at
FROM ai_qa_messages
WHERE NOT EXISTS (SELECT 1 FROM ai_qa_messages_new LIMIT 1);

DROP TABLE IF EXISTS ai_qa_messages;
ALTER TABLE ai_qa_messages_new RENAME TO ai_qa_messages;

CREATE INDEX IF NOT EXISTS idx_ai_qa_messages_tenant_created
  ON ai_qa_messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_qa_messages_tenant_session
  ON ai_qa_messages (tenant_id, session_key, created_at DESC);
-- 0005 建的去重索引随旧表一起被 DROP，这里必须原样重建：
-- 企业微信同一 MsgId 重推三次，靠它 + ON CONFLICT DO NOTHING 保证只记一条。
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_qa_messages_msg_id
  ON ai_qa_messages(msg_id, tenant_id) WHERE msg_id <> '';
