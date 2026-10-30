import type { Context, Next } from 'hono'
import type { Bindings, Variables } from '../types'
import { safeWarn } from '../utils/safeLogger'
import { getTenantId } from '../db/scoped'

/**
 * AI 爬虫 UA 识别表，与 robots.txt 里显式放行的那批保持一致。
 *
 * 顺序有意义：更具体的名字排在前面，避免宽泛的模式先命中。
 * 例如 Applebot-Extended 必须排在 Applebot 之前，OAI-SearchBot 必须排在 GPTBot 之前。
 */
const AI_CRAWLER_PATTERNS: Array<[string, RegExp]> = [
  ['OAI-SearchBot', /OAI-SearchBot|ChatGPT-User/i],
  ['GPTBot', /GPTBot/i],
  ['ClaudeBot', /ClaudeBot|Claude-Web|anthropic-ai/i],
  ['PerplexityBot', /PerplexityBot|Perplexity-User/i],
  ['Google-Extended', /Google-Extended/i],
  ['Applebot-Extended', /Applebot-Extended/i],
  ['Meta-ExternalAgent', /Meta-ExternalAgent|FacebookBot/i],
  ['CCBot', /CCBot/i],
  ['Amazonbot', /Amazonbot/i],
  ['Bytespider', /Bytespider/i],
  ['MistralAI-User', /MistralAI-User/i],
  ['cohere-ai', /cohere-ai/i],
  ['YouBot', /YouBot/i],
]

export function detectAiCrawler(userAgent: string): string {
  if (!userAgent) return ''
  for (const [name, pattern] of AI_CRAWLER_PATTERNS) {
    if (pattern.test(userAgent)) return name
  }
  return ''
}

/**
 * 记录 AI 爬虫对公开页面的访问。
 *
 * GEO 运营里最实际的问题不是「robots 有没有放行」，而是「GPTBot / ClaudeBot 到底来没来过」——
 * 这个中间件就是回答它的。几条成本约束：
 *
 *   - 只有命中 AI 爬虫 UA 的请求才写库，普通访客完全不产生写操作；
 *   - 每天每个爬虫只占一行（复合唯一键 + ON CONFLICT 自增），存储不随抓取量膨胀；
 *   - 写入放进 waitUntil，不阻塞响应；失败只记日志，绝不影响页面返回。
 *
 * 未应用 0003 迁移的库会报 no such table，这里降级为一条告警日志。
 */
export function aiCrawlerStats() {
  return async (c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) => {
    const bot = detectAiCrawler(c.req.header('user-agent') || '')
    const path = c.req.path
    const trackable = Boolean(bot)
      && c.req.method === 'GET'
      && !path.startsWith('/admin')
      && !path.startsWith('/api')
      && path !== '/healthz'

    if (trackable && c.env.DB) {
      const tenantId = getTenantId(c)
      const hitDate = new Date().toISOString().slice(0, 10)
      const safePath = path.slice(0, 300)
      c.executionCtx.waitUntil(
        c.env.DB.prepare(
          `INSERT INTO ai_crawler_hits (tenant_id, hit_date, bot, hits, last_path, last_seen_at)
           VALUES (?, ?, ?, 1, ?, datetime('now'))
           ON CONFLICT(hit_date, bot, tenant_id) DO UPDATE SET
             hits = ai_crawler_hits.hits + 1,
             last_path = excluded.last_path,
             last_seen_at = excluded.last_seen_at`
        ).bind(tenantId, hitDate, bot, safePath).run().catch((e) => {
          safeWarn('ai crawler hit record failed', { bot, error: String(e) })
        })
      )
    }

    await next()
  }
}
