import { safeError } from './safeLogger'
import type { Bindings } from '../types'
import type { PlatformKey } from './socialPlatforms'
import { runConfiguredAi, getAiSettings } from './aiSettings'
import { composeAiPrompt, getAiPromptSettings } from './aiPrompts'
import { getAiResponseText, parseAiJson } from './aiJson'

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export type SocialContent = { title: string; content: string; hashtags: string[] }

type SourceArticle = {
  title: string
  summary?: string | null
  content?: string | null
  seo_keywords?: string | null
  cityName?: string | null
}

const PROMPTS: Record<PlatformKey, (a: SourceArticle) => string> = {
  douyin: (a) => `把下面这篇行业文章改写成一条抖音短视频口播文案脚本。
标题：${a.title}
摘要：${a.summary || ''}

要求：
1. title：抖音标题，20字以内，要有吸引力（可以用数字、疑问句、"90%的人不知道"这类钩子，但不能夸大失实）；
2. content：口播脚本，分成"开头钩子（3秒抓住注意力）"→"2-3个信息点（口语化、短句）"→"结尾引导（关注/评论/咨询）"三段，总长150-250字，标注好每段作用；
3. hashtags：5个抖音风格话题词（不带#号），要包含"${a.cityName || '主题'}"相关的词。
只输出JSON，不要输出其他文字：{"title":"","content":"","hashtags":["",""]}`,

  kuaishou: (a) => `把下面这篇行业文章改写成一条快手短视频口播文案脚本，风格比抖音更接地气、更实在，少一些花哨钩子，多一些"实用""省钱""避坑"这类朴实表达。
标题：${a.title}
摘要：${a.summary || ''}

要求：
1. title：20字以内；
2. content：口播脚本，开头一句话说清楚"这条视频能帮你解决什么"，中间讲2-3个实用点，结尾引导关注，总长150-250字；
3. hashtags：5个快手风格话题词（不带#号），包含"${a.cityName || '主题'}"相关词。
只输出JSON：{"title":"","content":"","hashtags":["",""]}`,

  xiaohongshu: (a) => `把下面这篇行业文章改写成一篇小红书图文笔记。
标题：${a.title}
摘要：${a.summary || ''}

要求：
1. title：小红书风格标题，带1-2个emoji，20字以内，突出"干货""避坑""省钱"这类价值点；
2. content：正文，口语化、分点用emoji（如✅📌💡），200-350字，结尾引导"评论区聊聊/收藏备用"；
3. hashtags：6-8个小红书风格标签（不带#号），包含"${a.cityName || '主题'}"相关词。
只输出JSON：{"title":"","content":"","hashtags":["",""]}`,

  bilibili: (a) => `把下面这篇行业文章改写成一篇B站（哔哩哔哩）专栏图文文章，面向对行业知识感兴趣的年轻用户。
标题：${a.title}
摘要：${a.summary || ''}
正文参考：${(a.content || '').replace(/<[^>]+>/g, '').slice(0, 500)}

要求：
1. title：B站风格标题，可以稍微活泼但不能标题党，30字以内；
2. content：HTML格式（用<p>分段，可用<h3>做小标题），350-600字，语气专业但不生硬，可以适当口语化；
3. hashtags：3-5个分类标签（不带#号）。
只输出JSON，content字段里的双引号要转义：{"title":"","content":"","hashtags":["",""]}`,
}

export async function generateSocialContent(env: Bindings, platform: PlatformKey, article: SourceArticle, tenantId: number): Promise<SocialContent> {
  try {
    const promptSettings = await getAiPromptSettings(env, tenantId)
    const aiSettings = await getAiSettings(env, tenantId)
    const platformPrompt = PROMPTS[platform](article)
    const prompt = composeAiPrompt(promptSettings, null, {
      siteName: env.SITE_NAME || '网站内容平台',
      task: `生成${platform}平台分发文案`,
      title: article.title,
      summary: article.summary || '',
      city: article.cityName || '',
      keywords: article.seo_keywords || '',
    }) + `\n\n以下是本平台的专用写作要求，请优先遵守其输出格式：\n${platformPrompt}`
    const res: any = await runConfiguredAi(env, { messages: [{ role: 'user', content: prompt }] })
    if (!res) return fallbackContent(platform, article)
    const parsed = parseAiJson(getAiResponseText(res))
    if (parsed) {
      if (parsed.title && parsed.content) {
        return {
          title: String(parsed.title),
          content: String(parsed.content),
          hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String).slice(0, 8) : [],
        }
      }
    }
  } catch (e) {
    safeError(`社交平台内容生成失败(${platform})，降级为摘要模板`, e)
  }
  return fallbackContent(platform, article)
}

// AI 不可用或解析失败时的兜底方案：保证功能始终"能用"，只是没那么精细
function fallbackContent(platform: PlatformKey, a: SourceArticle): SocialContent {
  const base = a.summary || a.title
  const tags = [a.cityName, ...(a.seo_keywords ? a.seo_keywords.split(/[，,、]/) : [])].filter(Boolean).slice(0, 6) as string[]
  if (platform === 'bilibili') {
    return { title: a.title, content: `<p>${esc(base)}</p>`, hashtags: tags.length ? tags : ['内容分享'] }
  }
  return { title: a.title.slice(0, 20), content: base, hashtags: tags.length ? tags : ['内容分享'] }
}

// ---- 纯文本复制内容（抖音/快手/小红书）----
export function buildPlainCopyText(config: { hashtagStyle: (t: string) => string }, data: SocialContent): string {
  const tagsLine = data.hashtags.map((t) => config.hashtagStyle(t)).join(' ')
  return `${data.title}\n\n${data.content}\n\n${tagsLine}`
}

// ---- 富文本复制内容（哔哩哔哩专栏）----
export function buildRichCopyHtml(data: SocialContent): string {
  // 净化正文：剔除危险标签、全部 on* 事件属性、javascript:/vbscript:/data: 伪协议、
  // 以及未闭合标签残片，防止存储型 XSS 被拼进管理后台预览页（renderSocialEditor 中
  // copyPayload 直接内联到页面）。
  const ALLOWED_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'strong', 'br'])
  const bodyHtml = String(data.content || '')
    .replace(/<(script|style|iframe|object|embed|form|textarea|select)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|textarea|select)[^>]*>/gi, '')
    .replace(/\s+on[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:href|xlink:href|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (full, tagName) => {
      const tag = String(tagName).toLowerCase()
      if (!ALLOWED_TAGS.has(tag)) return ''
      return full.startsWith('</') ? '</' + tag + '>' : '<' + tag + '>'
    })
    .replace(/<[a-z][^>]*$/i, '')
    .trim()

  const tagsHtml = data.hashtags
    .map((t) => `<span style="display:inline-block;margin:0 8px 8px 0;padding:2px 10px;background:#e6f7fc;color:#00a1d6;border-radius:12px;font-size:12px">${esc(t)}</span>`)
    .join('')
  return `<section style="max-width:677px;margin:0 auto;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <h1 style="font-size:21px;font-weight:700;color:#111827;margin:0 0 16px">${esc(data.title)}</h1>
  ${bodyHtml}
  <div style="margin-top:24px">${tagsHtml}</div>
</section>`
}
