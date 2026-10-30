export type NewsPublishStatus = 'published' | 'pending_review'

export type ArticleWriteStatus = 'draft' | 'pending_review' | 'published'

export type NewsPublishDecision = {
  status: NewsPublishStatus
  reason: 'human_review_required' | 'quality_checks_failed' | 'quality_score_below_threshold' | 'auto_publish_gates_passed'
}

export const MIN_NEWS_QUALITY_SCORE = 65

/** 每来源每轮默认处理的新闻条数：1 条。兼顾 Workers AI CPU 与采集覆盖面。 */
export const DEFAULT_NEWS_ROUND_ITEMS = 1

/** 每来源每轮处理的新闻条数上限：5 条。超过会让单轮 AI 调用与 CPU 显著上升，
 * 对 Cloudflare Free 计划的 CPU 限额不友好，故钳制在此。 */
export const MAX_NEWS_ROUND_ITEMS = 5

/** 后台「系统设置」可覆盖的每轮采集条数（settings 键 `news_round_items`，默认 1，上限 5）。 */
export function getNewsRoundItemsLimit(settings: Record<string, string>): number {
  const raw = String(settings.news_round_items ?? '').trim()
  if (!raw) return DEFAULT_NEWS_ROUND_ITEMS
  const value = Math.trunc(Number(raw))
  if (!Number.isFinite(value)) return DEFAULT_NEWS_ROUND_ITEMS
  return Math.max(1, Math.min(MAX_NEWS_ROUND_ITEMS, value))
}

/** 后台「系统设置」可覆盖的质量门槛（settings 键 `news_quality_min`，默认 65）。 */
export function getNewsQualityThreshold(settings: Record<string, string>): number {
  const raw = String(settings.news_quality_min ?? '').trim()
  // 未配置（空/缺失）时回退默认 65；空字符串不能算 0 分门槛。
  if (!raw) return MIN_NEWS_QUALITY_SCORE
  const value = Number(raw)
  if (Number.isFinite(value) && value >= 0 && value <= 100) return Math.round(value)
  return MIN_NEWS_QUALITY_SCORE
}

/** AI/collector output never becomes public without an explicit human publish action. */
export function statusAfterAiDraft(requestedStatus: unknown): ArticleWriteStatus {
  return requestedStatus === 'draft' ? 'draft' : 'pending_review'
}

/** 自动发布需三道闸同时通过:开关开启、质量分达标、GEO 体检全部通过;缺一则进入人工审核。 */
export function decideNewsStatus(input: {
  autoPublish?: boolean
  qualityScore: number
  checksPassed: boolean
  /** 可选：后台配置的质量门槛，缺省用 MIN_NEWS_QUALITY_SCORE */
  minScore?: number
  geoPassed?: boolean
}): NewsPublishDecision {
  if (!input.checksPassed) {
    return { status: 'pending_review', reason: 'quality_checks_failed' }
  }

  const threshold = Number.isFinite(input.minScore) ? Number(input.minScore) : MIN_NEWS_QUALITY_SCORE
  if (Number(input.qualityScore || 0) < threshold) {
    return { status: 'pending_review', reason: 'quality_score_below_threshold' }
  }

  if (input.autoPublish && input.geoPassed) {
    return { status: 'published', reason: 'auto_publish_gates_passed' }
  }

  return { status: 'pending_review', reason: 'human_review_required' }
}
