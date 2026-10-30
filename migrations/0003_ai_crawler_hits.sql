-- AI 爬虫访问统计。
-- 目的：GEO 运营里最实际的问题不是「robots 有没有放行」，而是「GPTBot / ClaudeBot 到底来没来过」。
-- 只统计命中 AI 爬虫 User-Agent 的公开页面请求，普通访客不写库。
--
-- 复合唯一键 (hit_date, bot, tenant_id) 让每次命中都能走
-- `ON CONFLICT(hit_date, bot, tenant_id) DO UPDATE SET hits = hits + 1`，
-- 一天一个爬虫只占一行，不会随抓取量膨胀。
--
-- 成本提示：每命中一次写 1 次 D1。D1 免费额度是每天 10 万次写，
-- 常规 AI 爬虫抓取量远低于此；若某爬虫异常高频，也会在这里直接反映出来。
CREATE TABLE IF NOT EXISTS ai_crawler_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  hit_date TEXT NOT NULL,
  bot TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  last_path TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(hit_date, bot, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_crawler_hits_tenant_date
  ON ai_crawler_hits(tenant_id, hit_date DESC);

CREATE INDEX IF NOT EXISTS idx_ai_crawler_hits_bot
  ON ai_crawler_hits(bot, hit_date DESC);
