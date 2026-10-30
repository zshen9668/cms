import { safeWarn } from './safeLogger'
import type { Bindings } from '../types'
import { SettingsStore } from './settingsStore'

export type R2CleanupResult = {
  deleted: number
  nextCursor: string
  complete: boolean
}

export async function deleteR2PrefixBatch(
  env: Pick<Bindings, 'R2_MEDIA'>,
  prefix: string,
  cursor = '',
  limit = 25,
): Promise<R2CleanupResult> {
  const safePrefix = String(prefix || '').slice(0, 512)
  const safeLimit = Math.max(1, Math.min(25, Math.trunc(limit) || 25))
  const listed = await env.R2_MEDIA.list({
    prefix: safePrefix,
    limit: safeLimit,
    ...(cursor ? { cursor } : {}),
  })
  const keys = listed.objects.map((object) => object.key).filter(Boolean)
  if (keys.length) await env.R2_MEDIA.delete(keys)
  return {
    deleted: keys.length,
    nextCursor: listed.truncated ? String(listed.cursor || '') : '',
    complete: !listed.truncated,
  }
}

export async function deleteArticleD1Relations(env: Pick<Bindings, 'DB'>, articleId: number | string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM social_posts WHERE article_id=?').bind(articleId),
    env.DB.prepare('DELETE FROM review_logs WHERE article_id=?').bind(articleId),
    env.DB.prepare('DELETE FROM articles WHERE id=?').bind(articleId),
  ])
}

export async function removePageContact(
  env: Pick<Bindings, 'DB'>,
  pageKeys: string[],
  tenantId = 1,
): Promise<boolean> {
  if (!pageKeys.length) return false
  const store = SettingsStore.forTenant(env, tenantId)
  const raw = await store.get('page_contact_settings_json', '')
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return false
    let changed = false
    for (const key of pageKeys) {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) {
        delete parsed[key]
        changed = true
      }
    }
    if (!changed) return false
    await store.updateIf('page_contact_settings_json', JSON.stringify(parsed))
    return true
  } catch (e) {
    safeWarn('page contact cleanup skipped because JSON is invalid', { error: String(e) })
    return false
  }
}
