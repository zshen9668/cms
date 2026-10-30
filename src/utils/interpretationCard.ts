import { safeError } from './safeLogger'
import type { Bindings } from '../types'
import { generateInfographicSvg, type Slide } from './cardSvg'
import { getAiSettings, runConfiguredAi, type AiSettings } from './aiSettings'
import { composeAiPrompt, getAiPromptSettings, type AiPromptSettings } from './aiPrompts'
import { getAiResponseText } from './aiJson'

// 供后台"手动发布文章"场景使用：没有 cron 采集时生成的 slides_json，
// 这里现场调用一次 AI 提炼要点；AI 不可用或解析失败时降级为摘要切分，保证不中断发布流程。
export async function generateInterpretationCard(env: Bindings, article: { title: string; summary?: string }, tenantId: number, aiSettings?: AiSettings, aiPromptSettings?: AiPromptSettings): Promise<string> {
  const slides = await buildSlides(env, article, tenantId, aiSettings, aiPromptSettings)
  return generateInfographicSvg(article.title, slides)
}

async function buildSlides(env: Bindings, article: { title: string; summary?: string }, tenantId: number, aiSettings?: AiSettings, aiPromptSettings?: AiPromptSettings): Promise<Slide[]> {
  try {
    const promptSettings = aiPromptSettings || await getAiPromptSettings(env, tenantId)
    const effectiveSettings = aiSettings || await getAiSettings(env, tenantId)
    const prompt = composeAiPrompt(promptSettings, null, {
      siteName: env.SITE_NAME || '网站内容平台',
      task: '把行业文章核心内容提炼成3条要点，用于制作图解卡片',
      title: article.title,
      summary: article.summary || '',
    }, effectiveSettings)
    const res: any = await runConfiguredAi(env, { messages: [{ role: 'user', content: prompt }] }, effectiveSettings)
    if (!res) return []
    const text = getAiResponseText(res).trim()
    const match = text.match(/\[[\s\S]*\]/)
    if (match) {
      const arr = JSON.parse(match[0])
      if (Array.isArray(arr) && arr.length) {
        return arr.slice(0, 4).map((s: any) => ({ heading: String(s.heading || '要点'), text: String(s.text || '') }))
      }
    }
  } catch (e) {
    safeError('interpretation card AI 提炼失败，降级为摘要切分', e)
  }

  // 降级方案：按标点切分摘要/标题，保证任何情况下都能生成一张卡片
  const source = article.summary || article.title
  const parts = source.split(/[，。,.；;、]/).map((s) => s.trim()).filter(Boolean).slice(0, 3)
  if (!parts.length) return [{ heading: '要点', text: article.title.slice(0, 14) }]
  return parts.map((p, i) => ({ heading: ['核心信息', '企业影响', '执行建议'][i] || '文章要点', text: p.slice(0, 36) }))
}
