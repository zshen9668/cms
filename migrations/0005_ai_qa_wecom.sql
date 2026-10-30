-- 智能问答（AI Q&A）与企业微信接入
--
-- 背景：系统密钥页早已登记企业微信的 CorpID / AgentId / Secret / Token /
-- EncodingAESKey 五项，但一直没有落地代码——密钥填了也没有任何作用。
-- 本迁移补齐数据层：问答留痕 + 企业微信回调消息留痕。
--
-- 设计约定（与 0003/0004 保持一致）：
-- - 不加外键约束（D1 建表期外键在部分兼容场景会报错，历史上已统一去掉）。
-- - 文本字段一律 NOT NULL DEFAULT ''，避免前台渲染出 "null"。
-- - 整个文件幂等，可重复执行。
-- - 多租户：所有查询一律带 tenant_id，唯一约束也按租户作用域。
--
-- 成本提示：问答与回调消息各写 1 次 D1。问答端点本身有 KV 限流，
-- 企业微信回调只有真实企业成员发消息才会触发，量级可控。

-- ---------------------------------------------------------------------------
-- ai_qa_messages：每一次「前台智能问答 / 企业微信问答」的问答留痕
-- ---------------------------------------------------------------------------
-- 用途：
--   1. 后台「AI 问答」面板展示最近问答，便于运营发现内容缺口；
--   2. 失败排查（模型超时、未配置密钥、被限流）。
-- channel：web = 前台 POST /api/ai/ask；wecom = 企业微信回调。
-- ip_hash：只存 IP 的 SHA-256 前 32 位，不落明文，避免 PII 合规问题。
-- msg_id：企业微信消息去重键（同一 msGUID 重推只处理一次），Web 端为空串。
CREATE TABLE IF NOT EXISTS ai_qa_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL DEFAULT 'web',
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  question TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL DEFAULT '',
  -- 命中的站内来源（标题 + 路径），JSON 数组字符串；为空表示纯模型生成、无站内依据
  sources_json TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  -- 耗时毫秒；0 表示未统计（如被限流直接拒绝）
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT NOT NULL DEFAULT '',
  -- 已处理 = 已返回答案；rejected = 未通过人机校验/限流；error = 模型或存储失败
  status TEXT NOT NULL DEFAULT 'answered',
  error TEXT NOT NULL DEFAULT '',
  msg_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_qa_messages_tenant_created
  ON ai_qa_messages(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_qa_messages_channel
  ON ai_qa_messages(tenant_id, channel, created_at DESC);

-- 企业微信会重复推送同一条消息（客户端未及时收到响应就会重推），
-- 按 (msg_id, tenant_id) 唯一，配合 INSERT ... ON CONFLICT DO NOTHING 做幂等。
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_qa_messages_msg_id
  ON ai_qa_messages(msg_id, tenant_id) WHERE msg_id <> '';

-- ---------------------------------------------------------------------------
-- wecom_message_log：企业微信回调消息与回复的收发记录
-- ---------------------------------------------------------------------------
-- 与 ai_qa_messages 分开的理由：企业微信回调包含大量非提问消息
-- （成员加入、菜单点击、图片、语音等），它们不入问答表，但必须留痕，
-- 否则「为什么机器人没回我」没有任何排查依据。
-- direction：in = 成员发来的；out = 机器人回复的。
-- msg_id 存企业微信的 MsgId（普通消息才有），用于去重与腾讯侧对账。
CREATE TABLE IF NOT EXISTS wecom_message_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  direction TEXT NOT NULL DEFAULT 'in',
  msg_id TEXT NOT NULL DEFAULT '',
  msg_type TEXT NOT NULL DEFAULT 'text',
  from_user TEXT NOT NULL DEFAULT '',
  agent_id TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL DEFAULT '',
  -- processed = 已生成回复；ignored = 类型不支持或未启用；error = 处理失败
  status TEXT NOT NULL DEFAULT 'processed',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wecom_message_log_tenant_created
  ON wecom_message_log(tenant_id, created_at DESC);
