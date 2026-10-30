export type CitationRecord = {
  platform: string
  model: string
  query: string
  mentioned: boolean
  citedUrl: string
  checkedOn: string
}

export type PlatformCitationSummary = {
  platform: string
  checks: number
  mentions: number
  rate: number
}

export function answerMentionsSite(answer: string, siteName: string, siteUrl: string): { mentioned: boolean; citedUrl: string } {
  const text = String(answer || '')
  const host = (() => {
    try {
      return new URL(siteUrl).host.toLowerCase()
    } catch {
      return ''
    }
  })()
  const urls = Array.from(text.matchAll(/https?:\/\/[^\s)）\]"'<>]+/gi)).map((m) => m[0])
  const citedUrl = urls.find((u) => host && u.toLowerCase().includes(host)) || ''
  const nameHit = !!siteName && siteName.length >= 2 && text.toLowerCase().includes(siteName.toLowerCase())
  return { mentioned: !!citedUrl || nameHit, citedUrl }
}

export function summarizeCitations(records: CitationRecord[]): PlatformCitationSummary[] {
  const map = new Map<string, { checks: number; mentions: number }>()
  for (const r of records) {
    const cur = map.get(r.platform) || { checks: 0, mentions: 0 }
    cur.checks += 1
    if (r.mentioned) cur.mentions += 1
    map.set(r.platform, cur)
  }
  return Array.from(map.entries())
    .map(([platform, v]) => ({
      platform,
      checks: v.checks,
      mentions: v.mentions,
      rate: v.checks ? Math.round((v.mentions / v.checks) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.rate - a.rate || b.checks - a.checks)
}
