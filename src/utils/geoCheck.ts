export type GeoCheckItem = {
  key: 'lead' | 'process' | 'risk' | 'impact' | 'structure' | 'length'
  label: string
  ok: boolean
  hint: string
}

export type GeoCheckResult = {
  score: number
  passed: number
  total: number
  items: GeoCheckItem[]
}

const STRIP_TAGS = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi

export function stripHtmlForGeo(value: string): string {
  return String(value || '')
    .replace(STRIP_TAGS, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstParagraph(html: string): string {
  const match = String(html || '').match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  return stripHtmlForGeo(match?.[1] ?? html)
}

function headingTexts(html: string): string[] {
  return Array.from(String(html || '').matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)).map((m) => stripHtmlForGeo(m[1] ?? ''))
}

export function checkGeoContent(input: { title: string; content: string }): GeoCheckResult {
  const plain = stripHtmlForGeo(input.content)
  const chars = plain.replace(/\s+/g, '').length
  const lead = firstParagraph(input.content).replace(/\s+/g, '')
  const headings = headingTexts(input.content).join(' ')
  const bodyText = plain

  const items: GeoCheckItem[] = [
    {
      key: 'lead',
      label: '首段 80 字内给出核心结论',
      ok: lead.length > 0 && lead.length <= 80,
      hint: lead.length === 0 ? '缺少首段 <p>。' : lead.length > 80 ? `首段 ${lead.length} 字,超过 80 字,AI 搜索难以直接提取答案。` : '',
    },
    {
      key: 'process',
      label: '包含办理流程或企业执行步骤',
      ok: /办理流程|执行步骤|检查步骤|操作步骤|办理步骤/.test(headings + ' ' + bodyText),
      hint: '缺少“办理流程 / 企业执行步骤”相关小节或说明。',
    },
    {
      key: 'risk',
      label: '包含注意事项或风险提醒',
      ok: /注意事项|风险提醒|风险与注意|风险/.test(headings + ' ' + bodyText),
      hint: '缺少“注意事项 / 风险提醒”相关小节或说明。',
    },
    {
      key: 'impact',
      label: '包含企业实际影响',
      ok: /企业实际影响|对企业的影响|企业影响|实际影响/.test(headings + ' ' + bodyText),
      hint: '缺少“企业实际影响”小节,无法让读者判断与自己的关系。',
    },
    {
      key: 'structure',
      label: '至少 4 个 H2/H3 小节',
      ok: headingTexts(input.content).length >= 4,
      hint: '小节数量不足,结构不利于 AI 摘录和分段理解。',
    },
    {
      key: 'length',
      label: '正文字数达到 600 字以上',
      ok: chars >= 600,
      hint: `正文约 ${chars} 字,低于 600 字。`,
    },
  ]

  const passed = items.filter((item) => item.ok).length
  return {
    score: Math.round((passed / items.length) * 100),
    passed,
    total: items.length,
    items,
  }
}
