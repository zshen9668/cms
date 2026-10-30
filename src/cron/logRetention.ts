/**
 * 日志保留与自动清理任务。
 *
 * 提供 cleanExpiredLogs(env, tenantId) 对日志类表做超期清理：
 *   - rank_history：保留每个关键词最近 90 天快照，超期删除
 *   - ai_qa_messages：30 天前的记录只保留 question/answer 摘要，清空明细字段
 *   - collection_logs / submit_logs / review_logs：保留 180 天，超期删除
 *   - daily_stats：保留 365 天，超期删除
 *
 * 全部使用参数化查询，按 tenant_id 隔离，不会误删其他租户数据。
 */

import type { Bindings } from '../types'
import { safeError, safeInfo, safeWarn } from '../utils/safeLogger'

/** 各表保留天数 */
const RETENTION_DAYS = {
  rank_history: 90,
  ai_qa_messages: 30,
  collection_logs: 180,
  submit_logs: 180,
  review_logs: 180,
  daily_stats: 365,
} as const

type CleanResult = {
  table: string
  deleted: number
  updated: number
}

/** 对单个租户执行日志清理，返回各表清理统计 */
export async function cleanExpiredLogs(env: Bindings, tenantId: number): Promise<CleanResult[]> {
  const results: CleanResult[] = []
  const t = Number(tenantId)

  // --- rank_history：按每个关键词保留最近 90 天快照 ---
  try {
    // 找出每个关键词在 90 天内最新的保留行 id（取每个 keyword+engine 最近 1 行）
    const cutoffDate = new Date(Date.now() - RETENTION_DAYS.rank_history * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    const deleted = await env.DB.prepare(
      `DELETE FROM rank_history
       WHERE tenant_id = ?
         AND date < ?
         AND id NOT IN (
           SELECT id FROM rank_history r2
           WHERE r2.tenant_id = rank_history.tenant_id
             AND r2.keyword = rank_history.keyword
             AND r2.search_engine = rank_history.search_engine
           ORDER BY r2.created_at DESC
           LIMIT 1
         )`,
    ).bind(t, cutoffDate).run()
    results.push({ table: 'rank_history', deleted: Number((deleted as any)?.meta?.changes || 0), updated: 0 })
    const last = results[results.length - 1]
    if (last) safeInfo('log retention rank_history done', { deleted: last.deleted })
  } catch (e) {
    safeError('log retention rank_history failed', e)
    results.push({ table: 'rank_history', deleted: 0, updated: 0 })
  }

  // --- ai_qa_messages：30 天前记录只保留 question/answer，清空明细 ---
  try {
    const cutoffDate = new Date(Date.now() - RETENTION_DAYS.ai_qa_messages * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
    // 先统计受影响行数
    const stats = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM ai_qa_messages
       WHERE tenant_id = ? AND created_at < ? AND session_key <> ''`,
    ).bind(t, cutoffDate).first() as any
    const affected = Number((stats as any)?.n || 0)
    // 清空明细字段，仅保留 question/answer
    const updated = await env.DB.prepare(
      `UPDATE ai_qa_messages
       SET sources_json = '',
           model = '',
           latency_ms = 0,
           ip_hash = '',
           status = 'answered',
           error = '',
           msg_id = '',
           session_key = '',
           session_title = ''
       WHERE tenant_id = ? AND created_at < ? AND session_key <> ''`,
    ).bind(t, cutoffDate).run()
    results.push({ table: 'ai_qa_messages', deleted: 0, updated: affected })
    safeInfo('log retention ai_qa_messages done', { updated: affected })
  } catch (e) {
    safeError('log retention ai_qa_messages failed', e)
    results.push({ table: 'ai_qa_messages', deleted: 0, updated: 0 })
  }

  // --- collection_logs：保留 180 天 ---
  try {
    const cutoffDate = new Date(Date.now() - RETENTION_DAYS.collection_logs * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
    const deleted = await env.DB.prepare(
      'DELETE FROM collection_logs WHERE tenant_id = ? AND created_at < ?',
    ).bind(t, cutoffDate).run()
    results.push({ table: 'collection_logs', deleted: Number((deleted as any)?.meta?.changes || 0), updated: 0 })
    const last4 = results[results.length - 1]
    if (last4) safeInfo('log retention collection_logs done', { deleted: last4.deleted })
  } catch (e) {
    safeError('log retention collection_logs failed', e)
    results.push({ table: 'collection_logs', deleted: 0, updated: 0 })
  }

  // --- submit_logs：保留 180 天 ---
  try {
    const cutoffDate = new Date(Date.now() - RETENTION_DAYS.submit_logs * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
    const deleted = await env.DB.prepare(
      'DELETE FROM submit_logs WHERE tenant_id = ? AND created_at < ?',
    ).bind(t, cutoffDate).run()
    results.push({ table: 'submit_logs', deleted: Number((deleted as any)?.meta?.changes || 0), updated: 0 })
    const last5 = results[results.length - 1]
    if (last5) safeInfo('log retention submit_logs done', { deleted: last5.deleted })
  } catch (e) {
    safeError('log retention submit_logs failed', e)
    results.push({ table: 'submit_logs', deleted: 0, updated: 0 })
  }

  // --- review_logs：保留 180 天 ---
  try {
    const cutoffDate = new Date(Date.now() - RETENTION_DAYS.review_logs * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
    const deleted = await env.DB.prepare(
      'DELETE FROM review_logs WHERE tenant_id = ? AND created_at < ?',
    ).bind(t, cutoffDate).run()
    results.push({ table: 'review_logs', deleted: Number((deleted as any)?.meta?.changes || 0), updated: 0 })
    const last6 = results[results.length - 1]
    if (last6) safeInfo('log retention review_logs done', { deleted: last6.deleted })
  } catch (e) {
    safeError('log retention review_logs failed', e)
    results.push({ table: 'review_logs', deleted: 0, updated: 0 })
  }

  // --- daily_stats：保留 365 天（按 date 列）---
  try {
    const cutoffDate = new Date(Date.now() - RETENTION_DAYS.daily_stats * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    const deleted = await env.DB.prepare(
      'DELETE FROM daily_stats WHERE tenant_id = ? AND date < ?',
    ).bind(t, cutoffDate).run()
    results.push({ table: 'daily_stats', deleted: Number((deleted as any)?.meta?.changes || 0), updated: 0 })
    const last7 = results[results.length - 1]
    if (last7) safeInfo('log retention daily_stats done', { deleted: last7.deleted })
  } catch (e) {
    safeError('log retention daily_stats failed', e)
    results.push({ table: 'daily_stats', deleted: 0, updated: 0 })
  }

  return results
}

/** 对全部租户执行清理，返回按租户汇总的统计，并将结果持久化到 KV 供后台查看 */
export async function cleanExpiredLogsAllTenants(env: Bindings): Promise<{ tenantId: number; results: CleanResult[] }[]> {
  const tenantRows = await env.DB.prepare(
    'SELECT DISTINCT tenant_id FROM tenants',
  ).all() as any
  const tenants = (tenantRows.results || []).map((r: any) => Number(r.tenant_id || 0))
  const out: { tenantId: number; results: CleanResult[] }[] = []
  for (const tenantId of tenants) {
    const results = await cleanExpiredLogs(env, tenantId)
    out.push({ tenantId, results })
  }

  // 持久化到 KV，供后台 /admin/system 查看上次清理状态
  if (env.CACHE_KV) {
    try {
      const now = new Date().toISOString()
      const summary = {
        completedAt: now,
        tenants: out.map((o) => ({
          tenantId: o.tenantId,
          totalDeleted: o.results.reduce((s, r) => s + r.deleted, 0),
          totalUpdated: o.results.reduce((s, r) => s + r.updated, 0),
          results: o.results,
        })),
      }
      await env.CACHE_KV.put('log_retention:last_clean', JSON.stringify(summary), { expirationTtl: 7 * 24 * 60 * 60 })
    } catch (e) {
      safeWarn('log retention save kv failed', { error: String(e) })
    }
  }

  return out
}
