import { safeError, safeWarn } from './safeLogger'
import type { Bindings } from '../types'
import { getAiSettings, runConfiguredAi, type AiSettings } from './aiSettings'
import { composeAiPromptWithSystemContacts, getAiPromptSettings } from './aiPrompts'
import { getAiResponseText, parseAiJson } from './aiJson'
import { getSiteProfile } from './siteProfile'
import { SettingsStore } from './settingsStore'
import { stripHtmlForGeo } from './geoCheck'

export type AiPageContent = { title: string; summary: string; content: string }

function prepareModelContent(value: string): string {
  let text = String(value || '')
    .replace(/^\s*\`\`\`(?:html|markdown|md|text)?\s*/i, '')
    .replace(/\s*\`\`\`\s*$/i, '')
    .replace(/^(#{2,3})\s+(.+)$/gm, (_match, hashes, heading) => '<h' + (hashes.length === 2 ? '2' : '3') + '>' + String(heading).trim() + '</h' + (hashes.length === 2 ? '2' : '3') + '>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
    .trim()

  // 模型偶尔把连续的 Markdown 列表返回成裸 <li>；补成合法列表结构。
  text = text.replace(/(?:<li>[^<]*(?:<[^>]+>[^<]*)?<\/li>\s*){2,}/g, (block) => '<ul>' + block + '</ul>')
  return text
}

function ensureReadableStructure(html: string): string {
  const source = String(html || '').trim()
  if (!source) return source
  if ((source.match(/<h[23]>/gi) || []).length >= 3) return source

  const headings = ['适用对象与常见场景', '办理流程与材料准备', '风险与注意事项', '下一步行动建议']
  const paragraphs = source.match(/<p>[^]*?<\/p>/gi) || []
  if (paragraphs.length >= 4) {
    const out: string[] = []
    paragraphs.forEach((paragraph, index) => {
      if (index < headings.length) out.push('<h2>' + headings[index] + '</h2>')
      out.push(paragraph)
    })
    return out.join('')
  }

  // 模型有时返回完整纯文本而不是 HTML。不要因为缺少标签误判为无效，
  // 将自然段/句子按内容职责分成可读小节，再交给最终质量门槛检查。
  const plain = source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const sentences = plain.split(/(?<=[。！？.!?])\s*/).filter(Boolean)
  if (sentences.length >= 8) {
    const chunkSize = Math.ceil(sentences.length / 4)
    const out: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const chunk = sentences.slice(index * chunkSize, (index + 1) * chunkSize).join('')
      if (!chunk) continue
      out.push('<h2>' + headings[index] + '</h2><p>' + escapeText(chunk) + '</p>')
    }
    return out.join('')
  }

  return source
}

function cleanHtml(html: string): string {
  const allowed = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'br'])
  const sanitized = String(html || '')
    .replace(/<(script|style|iframe|object|embed|form|textarea|select)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|textarea|select)[^>]*>/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (full, tagName) => {
      const tag = String(tagName).toLowerCase()
      if (!allowed.has(tag)) return ''
      return full.startsWith('</') ? '</' + tag + '>' : '<' + tag + '>'
    })
    .trim()
  return sanitized.slice(0, 16000)
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
}

function textToHtml(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeText(part).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function validPageContent(value: any, fallbackTitle = '网站内容', fallbackSummary = ''): AiPageContent | null {
  if (!value) return null

  // 有些模型会把整个 JSON 对象再次包进 content 字符串；先解这一层。
  if (typeof value === 'string') {
    const nested = parseAiJson(value)
    if (nested && typeof nested === 'object' && ('content' in nested || 'title' in nested || 'summary' in nested)) {
      return validPageContent(nested, fallbackTitle, fallbackSummary)
    }

    // 明确像 JSON/Schema 残片但无法解析时，不要把它当正文保存。
    const looksLikeJsonArtifact = /^\s*[{\[]/.test(value) && /["']?(title|summary|content)["']?/i.test(value)
    if (looksLikeJsonArtifact) return null
  }

  const rawContent = typeof value === 'string' ? value : value.content
  const preparedContent = prepareModelContent(String(rawContent || '').trim())
  const content = ensureReadableStructure(cleanHtml(preparedContent))
  if (!content) return null

  const title = String(value?.title || fallbackTitle).trim()
  let summary = String(value?.summary || fallbackSummary).trim()
  // 新建文章允许摘要留空：先用生成正文提炼一段摘要，避免“正文留空→AI预览”因为摘要为空被质量检查拦截。
  if (summary.length < 50) {
    const plain = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const derived = plain.slice(0, 120)
    if (derived) summary = derived + (plain.length > derived.length ? '…' : '')
  }
  return {
    title: title || fallbackTitle,
    summary: summary || fallbackSummary,
    content: /<[a-z][^>]*>/i.test(content) ? content : textToHtml(content).slice(0, 16000),
  }
}

function contentPlainLength(content: string): number {
  return String(content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, '').length
}

function firstParagraphLength(html: string): number {
  const match = String(html || '').match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  if (!match) return 0
  return stripHtmlForGeo(match[1] ?? '').replace(/\s+/g, '').length
}

function headingCount(html: string): number {
  return (String(html || '').match(/<h[23][^>]*>/gi) || []).length
}

function qualityEnough(value: AiPageContent, type: 'city' | 'service' | 'landing' | 'article' | 'page'): boolean {
  const minLength = type === 'article' ? 650 : type === 'city' || type === 'service' || type === 'landing' ? 560 : 240
  const titleLength = value.title.replace(/\s+/g, '').length
  const summaryLength = value.summary.replace(/\s+/g, '').length
  const plain = value.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const headingCountVal = headingCount(value.content)
  const hasOperationalSection = /流程|步骤|办理|执行|检查|核对|材料/.test(plain)
  const hasRiskSection = /注意事项|风险|提醒/.test(plain)
  const hasAction = /建议|行动|下一步|咨询/.test(plain)
  const needsWorkflow = type === 'city' || type === 'service' || type === 'landing' || type === 'article'
  const needsStructuredContent = type === 'city' || type === 'service' || type === 'landing' || type === 'article'
  const minSummaryLength = type === 'article' ? 30 : 50
  // GEO 收录硬门槛：与 geoCheck.ts 保持完全一致
  const leadOk = firstParagraphLength(value.content) > 0 && firstParagraphLength(value.content) <= 80
  const hasImpact = /企业实际影响|对企业的影响|企业影响|实际影响/.test(plain)
  return titleLength >= 8 &&
    summaryLength >= minSummaryLength &&
    contentPlainLength(value.content) >= minLength &&
    leadOk &&
    hasImpact &&
    (!needsWorkflow || (hasOperationalSection && hasRiskSection && hasAction)) &&
    (!needsStructuredContent || headingCountVal >= 4)
}

function extractValidPageContent(result: any, fallbackTitle: string, fallbackSummary: string): AiPageContent | null {
  const rawText = getAiResponseText(result).trim()
  if (!rawText) return null

  const parsed = parseAiJson(rawText)
  const parsedValid = validPageContent(parsed, fallbackTitle, fallbackSummary)
  if (parsedValid) return parsedValid

  const plainText = rawText.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim()
  if (/^\s*[{\[]/.test(plainText) && /["']?(title|summary|content)["']?/i.test(plainText)) return null
  return validPageContent(plainText, fallbackTitle, fallbackSummary)
}

export async function generateAiPageContent(env: Bindings, tenantId: number, input: {
  type: 'city' | 'service' | 'landing' | 'article' | 'page'
  city?: string
  service?: string
  keyword?: string
  keywords?: string[]
  weight?: number
  title?: string
  summary?: string
  pageLabel?: string
  pagePath?: string
  sourceContent?: string
}, aiSettings?: AiSettings): Promise<AiPageContent | null> {
  let siteSettings: Record<string, string> = {}
  try {
    siteSettings = await SettingsStore.forTenant(env, tenantId).getMany([
      'site_name', 'site_topic', 'site_industry', 'primary_services',
      'primary_keywords', 'industry_keywords', 'site_keywords',
    ])
  } catch (e) {
    safeError('AI page profile load failed; using defaults', e)
  }
  const siteProfile = getSiteProfile(siteSettings, env.SITE_NAME || '')
  const subject = input.type === 'city'
    ? (input.city || '') + siteProfile.topic + '城市页'
    : input.type === 'service'
      ? (input.service || '') + '服务页'
      : input.type === 'landing'
        ? (input.city || '') + (input.service || '') + 'SEO落地页'
        : input.type === 'page'
          ? (input.pageLabel || '官网页面') + '内容页'
          : (input.title || input.keyword || siteProfile.topic + '文章') + '内容页'

  const promptSettings = await getAiPromptSettings(env, tenantId)
  const effectiveSettings = aiSettings || await getAiSettings(env, tenantId)
  const promptKey = input.type === 'city' ? 'city' : input.type === 'service' ? 'service' : input.type === 'landing' ? 'landing' : input.type === 'page' ? 'page' : 'article'
  const prompt = await composeAiPromptWithSystemContacts(env, tenantId, promptSettings, promptKey, {
    siteName: siteProfile.siteName || env.SITE_NAME || '网站内容平台',
    subject,
    city: input.city || '',
    service: input.service || '',
    keyword: input.keyword || '',
    keywords: Array.from(new Set([...(input.keywords || []), ...siteProfile.industryKeywords])).slice(0, 20).join('、'),
    weight: input.weight || 0,
    title: input.title || '',
    summary: input.summary || '',
    pageLabel: input.pageLabel || '',
    pagePath: input.pagePath || '',
    sourceContent: String(input.sourceContent || '').slice(0, 6000),
  }, effectiveSettings)
  const request = async (extraInstruction = '', settings: AiSettings = effectiveSettings) => {
    return await runConfiguredAi(
      env,
      { messages: [{ role: 'user', content: prompt + extraInstruction }] },
      settings,
    )
  }

  try {
    const first = await request('')
    if (first) {
      const valid = extractValidPageContent(first, subject, input.summary || '')
      if (valid && qualityEnough(valid, input.type)) return valid
      if (valid) safeWarn('AI page content below quality threshold; retrying', { type: input.type, title: valid.title })
    }

    // -fast 模型当前不能依赖 Workers AI JSON Mode，因此首轮失败时只重试一次，
    // 强化“只返回 JSON 对象”的要求，避免无意义地重复消耗 AI。
    const retry = await request(
      '\\n\\n重要：上一轮输出格式不符合要求。现在请重新生成，严格只输出一个合法 JSON 对象；不要 Markdown、不要 JSON 代码块、不要解释文字。JSON 必须包含 title、summary、content 三个字段。',
      { ...effectiveSettings, maxTokens: Math.max(effectiveSettings.maxTokens, 3072) },
    )
    const retryValid = extractValidPageContent(retry, subject, input.summary || '')
    if (retryValid && qualityEnough(retryValid, input.type)) return retryValid

    // 城市页再提供一次“纯正文”兜底：Fast 模型偶尔会在长 JSON 上截断，
    // 纯文本更稳定；解析后自动转为安全 HTML，避免后台直接提示“无有效内容”。
    // 'page' 同样纳入兜底：后台「AI 内容写作」的 AI写首页/服务页/关于我们等按钮
    // 走的都是 page 类型，之前没有兜底，模型一次 JSON 格式抖动就直接报“无法生成”。
    if (input.type === 'city' || input.type === 'service' || input.type === 'article' || input.type === 'landing' || input.type === 'page') {
      const topic = siteProfile.topic || siteProfile.industry || '网站主营业务'
      const fallbackPrompt = prompt + '\n\n当前进入纯正文兜底模式：不要输出JSON、Markdown、代码围栏或解释文字，只输出可发布正文。' + '\n' + (input.type === 'city'
        ? [
            '请直接写一篇“' + (input.city || '') + topic + '”城市/地区页面正文。',
            '不要输出 JSON、Markdown、代码围栏或解释文字。',
            '使用站点默认语言，约500-800字。',
            '围绕本地区真实用户需求，至少包含：适用对象/场景、服务范围、办理/执行流程或材料、常见风险、注意事项、行动建议；至少使用3个清晰小节。',
            '不要编造具体政策数字、政府文件编号、联系方式或客户案例。',
            '关键词只自然出现，不重复堆砌。',
            '只输出正文段落文本。',
          ].join('\n')
        : input.type === 'service'
          ? [
              '请直接写一篇“' + (input.service || '') + '”服务页面正文。',
              '不要输出 JSON、Markdown、代码围栏或解释文字。',
              '使用站点默认语言，约500-800字。',
              '必须包含：解决的问题、适用对象和服务场景、服务范围、办理/执行流程或准备材料、常见风险、注意事项、行动建议；至少使用3个清晰小节。',
              '内容只围绕“' + (input.service || '') + '”，不要泛泛介绍整个行业。',
              '不要编造具体政策数字、政府文件编号、联系方式或客户案例。',
              '关键词只自然出现，不重复堆砌。',
              '只输出正文段落文本。',
            ].join('\n')
          : input.type === 'article'
            ? [
                '请直接写一篇高质量、可发布的原创行业文章正文。',
                '标题：' + (input.title || ''),
                '摘要：' + (input.summary || ''),
                '已有资料：' + String(input.sourceContent || '').slice(0, 6000),
                '不要输出 JSON、Markdown、代码围栏或解释文字。',
                '使用站点默认语言，约600-900字。',
                '至少使用4个清晰小节：核心问题/变化、实际影响、办理或执行建议、风险与注意事项。',
                '优先保留资料中的可核实事实；资料没有的数据、数字、日期、文件编号不要自行补造。',
                '不要复述或拼接外部原文；要形成独立、有实际价值的解释。',
                '关键词只自然出现，不重复堆砌。',
                '只输出正文段落文本。',
              ].join('\n')
            : input.type === 'page'
              ? [
                  '请直接写一篇“' + (input.pageLabel || '官网页面') + '”页面正文。',
                  '页面地址：' + (input.pagePath || '/'),
                  '现有标题：' + (input.title || ''),
                  '现有副标题：' + (input.summary || ''),
                  '已有资料：' + String(input.sourceContent || '').slice(0, 6000),
                  '不要输出 JSON、Markdown、代码围栏或解释文字。',
                  '使用站点默认语言，约500-800字。',
                  '先判断这个页面在网站中的职责（首页讲清提供什么与下一步行动；列表页讲清范围与进入详情的方式；联系页讲清提交需求路径；关于我们讲清服务能力与边界），再组织内容。',
                  '至少使用3个清晰小节，每节都要有实际信息，不要空小节或模板化重复。',
                  '不要编造政策数字、政府文件编号、联系方式、客户案例或不存在的事实。',
                  '关键词只自然出现，不重复堆砌。',
                  '只输出正文段落文本。',
                ].join('\n')
              : [
                  '请直接写一篇“' + (input.city || '') + (input.service || '') + '”高质量SEO落地页正文。',
                '不要输出 JSON、Markdown、代码围栏或解释文字。',
                '使用站点默认语言，约600-900字。',
                '至少包含：适用对象、常见场景、服务范围、流程/材料、风险与注意事项、行动建议；至少使用4个清晰小节。',
                '不要编造具体政策数字、联系方式、政府文件编号或客户案例。',
                '城市和服务主题各自自然出现，不重复堆砌关键词。',
                '只输出正文段落文本。',
              ].join('\n'))
      const fallback = await runConfiguredAi(
        env,
        { messages: [{ role: 'user', content: fallbackPrompt }] },
        { ...effectiveSettings, maxTokens: Math.max(effectiveSettings.maxTokens, 4096) },
      )
      const fallbackValid = extractValidPageContent(fallback, subject, input.summary || '')
      if (fallbackValid && qualityEnough(fallbackValid, input.type)) return fallbackValid
    }
    return null
  } catch (e) {
    safeError('AI page content generation failed', e)
    throw e
  }
}
