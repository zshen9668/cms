export type PageContactMethods = { wechats: string[]; qqs: string[] }

function splitList(raw: unknown, max = 20): string[] {
  const value = String(raw || '')
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of value.split(/[\n,，;；|]+/)) {
    const item = part.trim().slice(0, 100)
    if (!item || seen.has(item)) continue
    seen.add(item)
    result.push(item)
    if (result.length >= max) break
  }
  return result
}

const PAGE_CONTACTS_KEY = 'page_contact_settings_json'

export function getPageContactSettings(settings: Record<string, string>): Record<string, PageContactMethods> {
  try {
    const raw = settings[PAGE_CONTACTS_KEY] ? JSON.parse(settings[PAGE_CONTACTS_KEY]) : {}
    if (!raw || typeof raw !== 'object') return {}
    const result: Record<string, PageContactMethods> = {}
    for (const [key, value] of Object.entries(raw as Record<string, any>)) {
      result[key] = {
        wechats: splitList(value?.wechats),
        qqs: splitList(value?.qqs),
      }
    }
    return result
  } catch {
    return {}
  }
}

export function getPageContact(
  settings: Record<string, string>,
  pageKey: string,
  fallback: PageContactMethods = { wechats: [], qqs: [] },
): PageContactMethods {
  const stored = getPageContactSettings(settings)[pageKey]
  return {
    wechats: stored?.wechats?.length ? stored.wechats : fallback.wechats,
    qqs: stored?.qqs?.length ? stored.qqs : fallback.qqs,
  }
}

export { PAGE_CONTACTS_KEY }
