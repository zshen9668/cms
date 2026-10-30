import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { readSettingsMap, saveSetting, getTenantId, permanentlyDeleteMediaObject } from './shared'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { safeError, safeWarn } from '../../utils/safeLogger'
import { renderMediaPage } from '../../templates/admin'
import { purgeCacheAll } from '../../middleware/cache'
import { SettingsStore } from '../../utils/settingsStore'
import { validateImageFile } from '../../utils/pageImages'

export const adminMediaRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const MEDIA_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  svg: 'image/svg+xml', pdf: 'application/pdf',
}

const COMPRESS_THRESHOLD_BYTES = 200 * 1024  // 200KB：建议手动压缩的阈值，不再自动压缩

function mediaPublicUrl(objectKey: string): string { return '/media/' + objectKey.slice('media/'.length) }
function mediaSafeKey(raw: unknown): string { const key = String(raw || '').trim(); if (!key || !key.startsWith('media/') || key.includes('..')) return ''; return key }

async function detachDeletedMediaReferences(c: any, objectKey: string): Promise<void> {
  const publicUrl = mediaPublicUrl(objectKey)
  const settings = await readSettingsMap(c.env, getTenantId(c))
  let settingsChanged = false
  if (String(settings.contact_qr_url || '').trim() === publicUrl) { await SettingsStore.for(c.env).delete('contact_qr_url'); settingsChanged = true }
  const { getImageStore, saveImageStore } = await import('../../utils/imageSettings')
  const store = getImageStore(settings)
  let imageChanged = false
  if (store.home?.key === objectKey || store.home?.url === publicUrl) { delete store.home; imageChanged = true }
  for (const group of ['cities', 'services'] as const) { for (const [slug, entry] of Object.entries(store[group])) { if (entry?.key === objectKey || entry?.url === publicUrl) { delete store[group][slug]; imageChanged = true } } }
  if (imageChanged) { await saveSetting(c.env, 'image_settings_json', saveImageStore(store), getTenantId(c)); settingsChanged = true }
  if (settingsChanged) await c.executionCtx?.waitUntil?.(purgeCacheAll(c.executionCtx))
}

export { mediaSafeKey }

/** 上传保护阈值：单文件超过 200KB 时在日志里标记「建议手动压缩」，但不再自动压缩。
 * Cloudflare Image Resizing 需要在 Workers 控制台启用 Capabilities → Image Resizing，
 * 启用后可通过 URL /resize=width:1600 按需压缩显示。 */
const COMPRESS_SUGGEST_THRESHOLD_BYTES = 200 * 1024

/** 判断是否超过建议压缩阈值（仅做日志提示，不自动压缩） */
function exceedsCompressThreshold(contentType: string | undefined, size: number): boolean {
  if (!contentType) return false
  const ct = contentType.toLowerCase()
  if (ct !== 'image/jpeg' && ct !== 'image/png' && ct !== 'image/webp') return false
  return size > COMPRESS_SUGGEST_THRESHOLD_BYTES
}

adminMediaRoutes.get('/media', async (c) => {
  const [listed, trackedResult] = await Promise.all([c.env.R2_MEDIA.list({ prefix: 'media/', limit: 1000 }), c.env.DB.prepare('SELECT object_key, original_name, content_type, original_size, stored_size FROM media_assets').all()])
  const tracked = new Map<string, any>()
  for (const row of trackedResult.results as any[]) tracked.set(String(row.object_key), row)
  const rows = (listed.objects || []).map((object: any) => { const key = String(object.key || ''); const meta = tracked.get(key); const name = String(meta?.original_name || key.split('/').pop() || key); const ext = (key.split('.').pop() || '').toLowerCase(); return { id: meta?.id ? Number(meta.id) : '', object_key: key, original_name: name, content_type: String(meta?.content_type || MEDIA_MIME_BY_EXT[ext] || 'application/octet-stream'), size: Number(object.size || 0), original_size: meta?.original_size != null ? Number(meta.original_size) : null, stored_size: meta?.stored_size != null ? Number(meta.stored_size) : null, uploaded_at: object.uploaded ? new Date(object.uploaded).toISOString() : '', r2_only: !meta } })
  rows.sort((a: any, b: any) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)))
  const total = rows.length
  const totalLabel = listed.truncated ? String(total) + '+' : String(total)
  const qrUrl = String(await SettingsStore.forTenant(c.env, getTenantId(c)).get('contact_qr_url', '') || '').trim()
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  return c.html(renderMediaPage(rows.slice(0, 1000), totalLabel as any, c.req.query('error') || '', {
    url: qrUrl,
    previewUrl: qrUrl.startsWith('/media/') ? '/wechat-qr?v=20260926-6' : qrUrl,
  }))
})

// ---- 微信二维码（媒体文件的一种，统一在媒体库管理）----
adminMediaRoutes.post('/media/contact-qr', async (c) => {
  const fileValue = (await c.req.parseBody()).file
  const file = fileValue instanceof File ? fileValue : null
  if (!file || !file.name) return c.redirect('/admin/media?error=' + encodeURIComponent('请选择二维码文件'))
  let actualType: string
  try { actualType = await validateImageFile(file) } catch (e) { return c.redirect('/admin/media?error=' + encodeURIComponent(String((e as any)?.message || '二维码图片格式无效'))) }
  const imageBytes = await file.arrayBuffer()
  if (!imageBytes.byteLength) return c.redirect('/admin/media?error=' + encodeURIComponent('二维码文件为空，请重新选择图片'))
  const store = SettingsStore.forTenant(c.env, getTenantId(c))
  const oldQr = await store.get('contact_qr_url', '')
  const ext = actualType === 'image/jpeg' ? 'jpg' : actualType.split('/')[1]
  const objectKey = 'media/contact/wechat-' + crypto.randomUUID() + '.' + ext
  await c.env.R2_MEDIA.put(objectKey, imageBytes, { httpMetadata: { contentType: actualType, contentDisposition: 'inline' }, customMetadata: { purpose: 'wechat-contact-qr', originalName: file.name } })
  await store.set('contact_qr_url', '/media/' + objectKey.slice('media/'.length))
  const oldUrl = String(oldQr ?? '')
  if (oldUrl.startsWith('/media/contact/')) await c.env.R2_MEDIA.delete('media/' + oldUrl.slice('/media/'.length)).catch((e) => safeError('old contact QR delete failed', e))
  c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/media')
})

adminMediaRoutes.post('/media/contact-qr/delete', async (c) => {
  const store = SettingsStore.forTenant(c.env, getTenantId(c))
  const configured = String(await store.get('contact_qr_url', '')).trim()
  if (configured.startsWith('/media/')) await permanentlyDeleteMediaObject(c, 'media/' + configured.slice('/media/'.length))
  else await store.delete('contact_qr_url')
  await purgeCacheAll(c.executionCtx)
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/media')
})

adminMediaRoutes.post('/media/upload', async (c) => {
  const maxBytes = 10 * 1024 * 1024
  const contentLength = Number(c.req.header('content-length') || 0)
  if (contentLength && contentLength > maxBytes + 256 * 1024) return c.redirect('/admin/media?error=' + encodeURIComponent('单文件最大 10MB'))
  const body = await c.req.parseBody({ all: true })
  const fileValue = body.file
  const file = fileValue instanceof File ? fileValue : null
  if (!file || !file.name) return c.redirect('/admin/media?error=' + encodeURIComponent('请选择文件'))
  if (file.size > maxBytes) return c.redirect('/admin/media?error=' + encodeURIComponent('单文件最大 10MB'))
  const allowed = /^(image\/(jpeg|png|webp|gif|svg\+xml)|application\/pdf)$/.test(file.type)
  if (!allowed) return c.redirect('/admin/media?error=' + encodeURIComponent('仅支持 JPG、PNG、WEBP、GIF、SVG、PDF'))
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'bin'
  const objectKey = 'media/' + new Date().toISOString().slice(0, 10) + '/' + crypto.randomUUID() + '.' + ext

  // 图片上传保护：超过 200KB 时在日志里标记「建议手动压缩」，不再自动压缩。
  // Cloudflare Image Resizing 需在 Workers 控制台启用 Capabilities → Image Resizing，
  // 启用后可通过 URL /resize=width:1600 按需压缩显示。
  if (exceedsCompressThreshold(file.type, file.size)) {
    safeWarn('media upload exceeds compress threshold', {
      objectKey,
      name: file.name,
      size: file.size,
      type: file.type,
      hint: '超过 200KB，建议手动压缩后再上传，或在 Cloudflare 控制台启用 Image Resizing 通过 /resize 参数按需压缩',
    })
  }

  const object = await c.env.R2_MEDIA.put(objectKey, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream', contentDisposition: 'inline' }, customMetadata: { originalName: file.name } })
  await c.env.DB.prepare('INSERT INTO media_assets (object_key, original_name, content_type, size, original_size, stored_size, etag) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(objectKey, file.name, file.type || 'application/octet-stream', file.size, file.size, file.size, object?.etag || null).run()
  return c.redirect('/admin/media')
})

adminMediaRoutes.post('/media/:id/delete', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.notFound()
  const row = await c.env.DB.prepare('SELECT object_key FROM media_assets WHERE id=?').bind(id).first() as any
  if (row) await permanentlyDeleteMediaObject(c, String(row.object_key))
  c.header('Cache-Control', 'no-store')
  await c.executionCtx?.waitUntil?.(purgeCacheAll(c.executionCtx))
  return c.redirect('/admin/media')
})

adminMediaRoutes.post('/media/delete-one', async (c) => {
  const body = await c.req.parseBody()
  const key = mediaSafeKey(body.object_key)
  if (!key) return c.redirect('/admin/media?error=' + encodeURIComponent('媒体文件地址无效'))
  const ok = await permanentlyDeleteMediaObject(c, key)
  if (!ok) return c.redirect('/admin/media?error=' + encodeURIComponent('文件不存在或删除失败，请重新加载后重试'))
  await c.executionCtx?.waitUntil?.(purgeCacheAll(c.executionCtx))
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/media')
})

adminMediaRoutes.post('/media/delete-selected', async (c) => {
  const body = await c.req.parseBody({ all: true })
  const raw = body.keys
  const keys = Array.from(new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).map((v) => mediaSafeKey(v)).filter(Boolean).slice(0, 25)))
  if (!keys.length) return c.redirect('/admin/media?error=' + encodeURIComponent('请先选择要删除的文件'))
  let deleted = 0
  for (const key of keys) { if (await permanentlyDeleteMediaObject(c, key)) deleted++ }
  await c.executionCtx?.waitUntil?.(purgeCacheAll(c.executionCtx))
  c.header('Cache-Control', 'no-store')
  return c.redirect('/admin/media' + (deleted ? '' : '?error=' + encodeURIComponent('没有文件被删除，请重新加载媒体库后重试')))
})
