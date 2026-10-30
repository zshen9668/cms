// 把 AI 生成的"图解卡片"文案(标题+要点)渲染成一张内联 SVG 信息图。
// 相比生成真实视频/AI图片，这个方案零外部依赖、零额外费用、渲染稳定可控，
// 同时满足"图文解读"的展示效果，前台再配合简单 JS 做卡片轮播即可呈现类似"动态解读"的体验。

export type Slide = { heading: string; text: string }

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

// 简单的文本自动换行（按字符数粗略切分，适配中文场景）
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const ch of text) {
    current += ch
    if (current.length >= maxCharsPerLine) {
      lines.push(current)
      current = ''
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 3)
}

export function generateInfographicSvg(articleTitle: string, slides: Slide[]): string {
  const width = 800
  const cardW = 240
  const cardH = 280
  const gap = 20
  const startX = 20
  const height = 140 + cardH + 40

  const titleLines = wrapText(articleTitle, 24)

  const cards = slides.slice(0, 4).map((s, i) => {
    const x = startX + i * (cardW + gap)
    const heading = String(s?.heading || '').trim()
    const fallbackHeadings = ['核心信息', '企业影响', '执行建议', '风险提醒']
    const displayHeading = /^要点\s*[1-4]?$/.test(heading) ? (fallbackHeadings[i] ?? '文章要点') : (heading || '文章要点')
    const headingLines = wrapText(displayHeading, 8)
    const textLines = wrapText(String(s?.text || ''), 12)
    return `
    <g transform="translate(${x}, 140)">
      <rect width="${cardW}" height="${cardH}" rx="14" fill="#fffdf9" stroke="#e4ddd2" stroke-width="1.5" />
      <circle cx="34" cy="36" r="16" fill="#eee8de" />
      <text x="34" y="42" text-anchor="middle" font-size="16" font-weight="700" fill="#59635b">${i + 1}</text>
      ${headingLines.map((l, li) => `<text x="24" y="${72 + li * 24}" font-size="18" font-weight="700" fill="#2f3833">${esc(l)}</text>`).join('')}
      ${textLines.map((l, li) => `<text x="24" y="${72 + headingLines.length * 24 + 20 + li * 20}" font-size="13" fill="#707870">${esc(l)}</text>`).join('')}
    </g>`
  }).join('')

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, PingFang SC, Microsoft YaHei, sans-serif">
  <defs>
    <linearGradient id="hdr" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#1454b3"/>
      <stop offset="100%" stop-color="#1f6fe0"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="#f4f7fb" />
  <rect width="${width}" height="110" fill="url(#hdr)" />
  <text x="24" y="40" font-size="14" fill="#eee8de">文章要点</text>
  ${titleLines.map((l, i) => `<text x="24" y="${68 + i * 26}" font-size="22" font-weight="700" fill="#ffffff">${esc(l)}</text>`).join('')}
  ${cards}
</svg>`
}
