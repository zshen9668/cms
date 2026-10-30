export type ImageEntry = { url: string; key: string; alt: string; updatedAt?: string }

export type ImageStore = {
  home?: ImageEntry
  cities: Record<string, ImageEntry>
  services: Record<string, ImageEntry>
}

export function getImageStore(settings: Record<string, string>): ImageStore {
  const base: ImageStore = { cities: {}, services: {} }
  try {
    const raw = settings.image_settings_json ? JSON.parse(settings.image_settings_json) : {}
    return {
      home: raw?.home && typeof raw.home.url === 'string' ? raw.home : undefined,
      cities: raw?.cities || {},
      services: raw?.services || {},
    }
  } catch {
    return base
  }
}

export function saveImageStore(store: ImageStore): string {
  return JSON.stringify(store)
}
