export function getServiceExternalLinks(settings: Record<string, string>): Record<string, string> {
  try {
    const raw = settings.service_external_links ? JSON.parse(settings.service_external_links) : {}
    const result: Record<string, string> = {}
    if (!raw || typeof raw !== 'object') return result
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) result[key] = value.trim()
    }
    return result
  } catch {
    return {}
  }
}
