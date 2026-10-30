// 关键词机会分计算策略
// opportunity_score = 城市权重 * 0.5 + 服务权重 * 0.3 + (100 - 难度惩罚) * 0.2
// 城市权重：一线100 / 新一线75 / 二线55 / 三线35（可在城市管理里覆盖 tier 再重算）
// 服务权重：来自 services.demand_weight（后台可编辑，按业务需求量设置 0-100）
// 难度：目前是人工/AI 估计的枚举（低/中/高），也支持后续接入第三方关键词工具后写回 search_volume/difficulty 再重算

function normalizeKeyword(value: unknown): string {
  return String(value || '')
    .replace(/[\u0000\r\t]+/g, ' ')
    .replace(/[|｜]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,，;；、]+|[,，;；、]+$/g, '')
    .slice(0, 80)
}

export const MIN_INDEXABLE_OPPORTUNITY_SCORE = 65

const TIER_WEIGHT: Record<string, number> = { '一线': 100, '新一线': 75, '二线': 55, '三线': 35 }
const DIFFICULTY_PENALTY: Record<string, number> = { '低': 10, '中': 30, '高': 55 }

// 站点超级链接低质惩罚：关键词若与站点主题/行业/核心服务无显著语义重叠，
// 生成的落地页容易被 AI 引擎判定为程序化垃圾页面，降低 GEO 收录优先级。
// score *= 0.5 的系数保留页面可被检索，但不会在首页/列表页获得优先展示。
export const LOW_RELEVANCE_SCORE_FACTOR = 0.5

/** 判断关键词与站点主题是否存在语义重叠。
 * 重叠任一即视为相关：站点主题、行业、核心关键词、核心服务、城市名、服务名。 */
export function isKeywordRelevantToSite(
  keyword: string,
  siteProfile: { topic?: string; industry?: string; primaryKeywords?: string[]; industryKeywords?: string[]; primaryServices?: string[] },
  cityName?: string,
  serviceName?: string,
): boolean {
  const term = normalizeKeyword(keyword).toLocaleLowerCase()
  if (!term) return false

  const text = [
    siteProfile?.topic,
    siteProfile?.industry,
    cityName,
    serviceName,
    ...(siteProfile?.primaryKeywords || []),
    ...(siteProfile?.industryKeywords || []),
    ...(siteProfile?.primaryServices || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()

  // 完全包含或作为独立词出现
  return text.split(/[,，;；\s、|]+/).some((t) => t && term.includes(normalizeKeyword(t).toLocaleLowerCase()))
}

export function calcOpportunityScore(params: { tier: string; serviceWeight: number; difficulty: string; searchVolume?: number }) {
  const cityWeight = TIER_WEIGHT[params.tier] ?? 50
  const penalty = DIFFICULTY_PENALTY[params.difficulty] ?? 30
  let score = cityWeight * 0.5 + params.serviceWeight * 0.3 + (100 - penalty) * 0.2
  // 有真实搜索量数据时只做小幅分层加分，避免搜索量单项压过城市/服务/难度。
  const volume = Math.max(0, Math.trunc(Number(params.searchVolume || 0)))
  const volBoost = volume >= 10000 ? 20 : volume >= 1000 ? 15 : volume >= 100 ? 10 : volume >= 10 ? 5 : 0
  if (volBoost > 0) score = score * 0.8 + volBoost
  return Math.max(0, Math.min(100, Math.round(score)))
}

// 根据机会分给出建议难度标签（用于新生成、尚无人工评估的关键词）
// 关键词的 landing 页面 slug 生成规则：城市slug-服务slug