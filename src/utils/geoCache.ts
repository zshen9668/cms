import { safeWarn } from './safeLogger'
import type { Bindings } from '../types'

const CITY_CACHE_KEY = 'geo:city:name_to_id'
const SERVICE_CACHE_KEY = 'geo:service:name_to_id'
const CACHE_TTL = 3600

export interface GeoEntity {
  id: number
  name: string
  slug: string
}

export interface GeoCache {
  cities: Map<string, GeoEntity>
  services: Map<string, GeoEntity>
  citySlugs: Map<string, GeoEntity>
  serviceSlugs: Map<string, GeoEntity>
}

export async function loadGeoCache(env: Pick<Bindings, 'CACHE_KV' | 'DB'>): Promise<GeoCache> {
  const kv = env.CACHE_KV
  if (!kv) return buildEmptyCache()

  try {
    const [cityData, serviceData] = await Promise.all([
      kv.get(CITY_CACHE_KEY, 'json'),
      kv.get(SERVICE_CACHE_KEY, 'json'),
    ])

    if (cityData && serviceData) {
      return {
        cities: new Map(Object.entries(cityData as Record<string, GeoEntity>)),
        services: new Map(Object.entries(serviceData as Record<string, GeoEntity>)),
        citySlugs: new Map(),
        serviceSlugs: new Map(),
      }
    }
  } catch (e) {
    safeWarn('geo cache load failed', { error: String(e) })
  }

  return rebuildGeoCache(env)
}

export async function rebuildGeoCache(env: Pick<Bindings, 'CACHE_KV' | 'DB'>): Promise<GeoCache> {
  const [cityRows, serviceRows] = await Promise.all([
    env.DB.prepare('SELECT id, name, slug FROM cities WHERE is_active = 1').all(),
    env.DB.prepare('SELECT id, name, slug FROM services WHERE is_active = 1').all(),
  ])

  const cities = new Map<string, GeoEntity>()
  const citySlugs = new Map<string, GeoEntity>()
  for (const row of cityRows.results as any[]) {
    const entity = { id: row.id, name: row.name, slug: row.slug }
    cities.set(row.name.toLowerCase().trim(), entity)
    citySlugs.set(row.slug, entity)
  }

  const services = new Map<string, GeoEntity>()
  const serviceSlugs = new Map<string, GeoEntity>()
  for (const row of serviceRows.results as any[]) {
    const entity = { id: row.id, name: row.name, slug: row.slug }
    services.set(row.name.toLowerCase().trim(), entity)
    serviceSlugs.set(row.slug, entity)
  }

  const cache = { cities, services, citySlugs, serviceSlugs }

  if (env.CACHE_KV) {
    try {
      await Promise.all([
        env.CACHE_KV.put(CITY_CACHE_KEY, JSON.stringify(Object.fromEntries(cities)), { expirationTtl: CACHE_TTL }),
        env.CACHE_KV.put(SERVICE_CACHE_KEY, JSON.stringify(Object.fromEntries(services)), { expirationTtl: CACHE_TTL }),
      ])
    } catch (e) {
      safeWarn('geo cache save failed', { error: String(e) })
    }
  }

  return cache
}

function buildEmptyCache(): GeoCache {
  return { cities: new Map(), services: new Map(), citySlugs: new Map(), serviceSlugs: new Map() }
}

export function findMatchingGeo(text: string, cache: GeoCache, primaryServices: string[] = []): { city?: GeoEntity; service?: GeoEntity } {
  const lowerText = text.toLowerCase()
  let city: GeoEntity | undefined
  let service: GeoEntity | undefined

  const sortedCities = [...cache.cities.entries()].sort((a, b) => b[0].length - a[0].length)
  for (const [name, entity] of sortedCities) {
    if (lowerText.includes(name)) {
      city = entity
      break
    }
  }

  const sortedServices = [...cache.services.entries()].sort((a, b) => b[0].length - a[0].length)
  for (const [name, entity] of sortedServices) {
    if (lowerText.includes(name)) {
      service = entity
      break
    }
  }

  if (!service) {
    for (const svcName of primaryServices) {
      if (lowerText.includes(svcName.toLowerCase())) {
        const found = cache.services.get(svcName.toLowerCase())
        if (found) {
          service = found
          break
        }
      }
    }
  }

  return { city, service }
}
