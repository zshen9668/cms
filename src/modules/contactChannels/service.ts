import type { ContactChannel, ContactChannelDisplay, ContactChannelType } from './types'

function splitLegacy(raw: string | undefined): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of String(raw || '').split(/[\n,，;；|]+/)) {
    const item = part.trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    result.push(item.slice(0, 100))
    if (result.length >= 20) break
  }
  return result
}

function normalizeDisplay(input: any, type: ContactChannelType): ContactChannelDisplay {
  const display = input && typeof input.display === 'object' ? input.display : {}
  return {
    // Keep legacy-friendly defaults while allowing explicit per-surface control.
    header: display.header === true || (display.header == null && type === 'wechat'),
    footer: display.footer !== false,
    contact: display.contact !== false,
    ai: display.ai !== false,
  }
}

function normalizeChannel(input: any, index: number): ContactChannel | null {
  if (!input || typeof input !== 'object') return null
  const value = String(input.value || '').trim()
  if (!value) return null
  const type = String(input.type || 'custom') as ContactChannelType
  return {
    id: String(input.id || `ch-${index}-${type}`),
    type,
    label: String(input.label || type).slice(0, 50),
    value: value.slice(0, 200),
    enabled: input.enabled !== false,
    sortOrder: Number(input.sortOrder ?? input.sort ?? index),
    openUrl: String(input.openUrl || '').slice(0, 300) || undefined,
    qrUrl: String(input.qrUrl || input.qr_url || '').slice(0, 500) || undefined,
    locale: String(input.locale || 'all'),
    display: normalizeDisplay(input, type),
  }
}

/** Read channels from settings map (sync, for page render). */
export function getContactChannelsFromSettings(settings: Record<string, string>): ContactChannel[] {
  try {
    const raw = settings.contact_channels ? JSON.parse(settings.contact_channels) : null
    let list: any[] = []
    if (Array.isArray(raw)) list = raw
    else if (raw && Array.isArray(raw.items)) list = raw.items
    const channels = list.map(normalizeChannel).filter(Boolean) as ContactChannel[]
    // A valid canonical config is authoritative even when it is intentionally empty.
    // Only fall back to legacy fields when the canonical value is missing or invalid.
    if (Array.isArray(raw) || (raw && Array.isArray(raw.items))) {
      return channels.sort((a, b) => a.sortOrder - b.sortOrder)
    }
  } catch {
    /* fall through to legacy fields */
  }

  const legacy: ContactChannel[] = []
  let i = 0
  for (const phone of splitLegacy(settings.contact_phones || settings.contact_phone)) {
    legacy.push({ id: `legacy-phone-${i}`, type: 'phone', label: '电话', value: phone, enabled: true, sortOrder: i++, locale: 'all', display: { header: false, footer: true, contact: true, ai: true } })
  }
  for (const wechat of splitLegacy(settings.contact_wechats || settings.contact_wechat)) {
    legacy.push({ id: `legacy-wechat-${i}`, type: 'wechat', label: '微信', value: wechat, enabled: true, sortOrder: i++, locale: 'all', display: { header: true, footer: true, contact: true, ai: true } })
  }
  for (const qq of splitLegacy(settings.contact_qqs)) {
    legacy.push({ id: `legacy-qq-${i}`, type: 'qq', label: 'QQ', value: qq, enabled: true, sortOrder: i++, locale: 'all', display: { header: false, footer: true, contact: true, ai: true } })
  }
  return legacy
}

export function serializeContactChannels(channels: ContactChannel[]): string {
  return JSON.stringify({
    items: (channels || []).map((item, index) => ({
      id: item.id || `ch-${index}`,
      type: item.type || 'custom',
      label: String(item.label || '').slice(0, 50),
      value: String(item.value || '').slice(0, 200),
      enabled: item.enabled !== false,
      sortOrder: Number(item.sortOrder ?? index),
      openUrl: item.openUrl || '',
      qrUrl: item.qrUrl || '',
      locale: item.locale || 'all',
      display: {
        header: item.display?.header === true,
        footer: item.display?.footer !== false,
        contact: item.display?.contact !== false,
        ai: item.display?.ai !== false,
      },
    })),
  })
}

/** Filter enabled channels for a specific presentation surface. */
export function filterContactChannels(
  channels: ContactChannel[],
  surface: 'header' | 'footer' | 'contact' | 'ai',
): ContactChannel[] {
  return (channels || [])
    .filter((channel) => channel.enabled !== false)
    .filter((channel) => (channel.display || {})[surface] !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Convert channels to the legacy ContactMethods shape used by older templates. */
export function channelsToContactMethods(channels: ContactChannel[]) {
  const phones: string[] = []
  const wechats: string[] = []
  const qqs: string[] = []
  for (const ch of filterContactChannels(channels, 'contact')) {
    if (ch.type === 'phone') phones.push(ch.value)
    else if (ch.type === 'wechat') wechats.push(ch.value)
    else if (ch.type === 'qq') qqs.push(ch.value)
  }
  return { phones, wechats, qqs }
}