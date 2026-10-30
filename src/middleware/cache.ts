import { safeError } from '../utils/safeLogger'
type CachePurgeContext = {
  cache?: {
    purge: (options: { tags?: string[]; purgeEverything?: boolean }) => Promise<unknown>
  }
}

const PUBLIC_CACHE_TAG = 'whitelabel-cms-public'

function getCache(ctx: unknown): CachePurgeContext['cache'] {
  if (!ctx || typeof ctx !== 'object') return undefined
  const candidate = (ctx as CachePurgeContext).cache
  return candidate && typeof candidate.purge === 'function' ? candidate : undefined
}

export async function purgeCacheAll(ctx: unknown): Promise<void> {
  const cache = getCache(ctx)
  if (!cache) return
  try {
    await cache.purge({ tags: [PUBLIC_CACHE_TAG] })
  } catch (e) {
    safeError('Workers Cache purge failed', e)
  }
}

export async function purgeCacheEverything(ctx: unknown): Promise<boolean> {
  const cache = getCache(ctx)
  if (!cache) return false
  try {
    await cache.purge({ purgeEverything: true })
    return true
  } catch (e) {
    safeError('Workers Cache purgeEverything failed', e)
    return false
  }
}

export async function purgeCacheTags(ctx: unknown, tags: string[]): Promise<void> {
  const valid = tags.filter((tag) => /^[\x21-\x7E]+$/.test(tag)).slice(0, 100)
  if (!valid.length) return

  const cache = getCache(ctx)
  if (!cache) return
  try {
    await cache.purge({ tags: valid })
  } catch (e) {
    safeError('Workers Cache tag purge failed', e)
  }
}

export function mediaCacheTag(objectKey: string): string {
  return 'whitelabel-cms-r2-' + objectKey.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 900)
}
