-- ============================================================================
-- 白标 CMS 留言表单 UTM 透传（0011）
-- ============================================================================
-- 留言表单新增 UTM 来源字段，用于获客来源分析：
-- utm_source / utm_medium / utm_campaign / utm_term / utm_content
-- 字段从前台表单的隐藏输入读取（前端从 URL query string 解析）。
-- utm 列已并回 0001_baseline 的 CREATE TABLE messages，本文件只保留幂等索引。
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_messages_utm_source ON messages(utm_source);
CREATE INDEX IF NOT EXISTS idx_messages_utm_campaign ON messages(utm_campaign);
