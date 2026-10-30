// 微信公众号编辑器只认内联 style，会剥离 <style> 标签和 class，
// 所以这里把站内的 <p>/<h1-3> 转成带内联样式的版本，浏览器"复制富文本"粘贴到公众号编辑器时能保留排版。
// 本文件只负责"生成给人看/粘贴的HTML"，不调用任何微信接口。

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export type WechatSourceArticle = {
  id: number
  title: string
  wechat_title?: string | null
  content: string
  summary?: string | null
  wechat_summary?: string | null
  seo_keywords?: string | null
  source_name?: string | null
  cityName?: string | null
}

export function buildWechatHtml(article: WechatSourceArticle): string {
  const title = article.wechat_title || article.title

  // 净化文章正文：剔除 script/style/iframe/object/embed 等危险标签、全部 on* 事件属性、
  // javascript:/vbscript:/data: 伪协议，以及未闭合的 < 标签残片，防止存储型 XSS
  // 被拼进管理后台预览页（renderWechatEditor 中 wechatHtml 直接内联到页面）。
  const ALLOWED_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'strong', 'br'])
  let bodyHtml = String(article.content || '')
    .replace(/<(script|style|iframe|object|embed|form|textarea|select)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|textarea|select)[^>]*>/gi, '')
    .replace(/\s+on[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:href|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (_m) => {
      return ''
    })
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (full, tagName) => {
      const tag = String(tagName).toLowerCase()
      if (!ALLOWED_TAGS.has(tag)) return ''
      return full.startsWith('</') ? '</' + tag + '>' : '<' + tag + '>'
    })
    // 兜底：丢弃末尾未闭合的 < 标签残片（浏览器会把它与后续模板标签拼成可执行标签）
    .replace(/<[a-z][^>]*$/i, '')
  bodyHtml = bodyHtml
    .replace(/<p>/g, '<p style="margin:0 0 22px;padding:0;line-height:1.85;font-size:16px;color:#333333;letter-spacing:0.5px;text-align:justify">')
    .replace(/<p\s+[^>]*>/g, '<p style="margin:0 0 22px;padding:0;line-height:1.85;font-size:16px;color:#333333;letter-spacing:0.5px;text-align:justify">')
    .replace(/<h1[^>]*>/g, '<h1 style="font-size:20px;font-weight:700;color:#111827;margin:28px 0 14px;line-height:1.5">')
    .replace(/<h2[^>]*>/g, '<h2 style="font-size:19px;font-weight:700;color:#111827;margin:26px 0 14px;line-height:1.5">')
    .replace(/<h3[^>]*>/g, '<h3 style="font-size:17px;font-weight:700;color:#111827;margin:22px 0 12px;line-height:1.5">')
    .replace(/<strong>/g, '<strong style="color:#1f6fe0">')

  const tagList = [
    article.cityName,
    ...(article.seo_keywords ? article.seo_keywords.split(/[，,、]/).map((s) => s.trim()).filter(Boolean) : []),
  ]
    .filter(Boolean)
    .slice(0, 6) as string[]

  const tagsHtml = tagList
    .map((tag) => `<span style="display:inline-block;margin:0 8px 8px 0;padding:2px 10px;background:#f0f7ff;color:#1f6fe0;border-radius:12px;font-size:12px">#${esc(tag)}#</span>`)
    .join('')

  return `<section style="max-width:677px;margin:0 auto;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <h1 style="font-size:22px;font-weight:700;color:#111827;line-height:1.4;margin:0 0 18px">${esc(title)}</h1>
  ${bodyHtml}
  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee">
    ${tagsHtml}
  </div>
  <p style="margin-top:20px;font-size:12px;color:#999999;line-height:1.6">
    ${article.source_name ? `内容参考：${esc(article.source_name)}，` : ''}本文由系统辅助整理，仅供参考，具体以最新官方政策为准。
  </p>
</section>`
}

// ============================================================
// 以下为微信公众号 API 对接的预留位置——当前版本【不启用】，仅作为后续开发的接口约定。
// 真正接入时大致流程：
//   1. 用 WECHAT_APPID + WECHAT_APPSECRET 换取 access_token（有效期2小时，需自行缓存/续期，建议存 KV）
//   2. 调用「新增草稿」接口 POST https://api.weixin.qq.com/cgi-bin/draft/add，
//      把 buildWechatHtml() 生成的正文 + 标题/摘要/封面 media_id 传过去，得到 media_id
//   3. 如需定时发布，调用「发布」接口 POST https://api.weixin.qq.com/cgi-bin/freepublish/submit
//      （微信本身的"定时发布"要在公众号后台手动设置，开放接口目前是"立即发布到草稿"，
//        真正的定时得自己用 Cron Trigger 在预约时间点再调用发布接口）
//   4. 封面图需要先调用「上传图文消息内的图片获取URL」或「新增永久素材」接口拿到 media_id，
//      不能直接用外部图床链接
// ============================================================
