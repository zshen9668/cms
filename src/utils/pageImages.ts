import type { Bindings } from '../types'
import type { ImageEntry, ImageStore } from './imageSettings'

export async function validateImageFile(file: File, allowGif = false): Promise<string> {
  const declared = String(file.type || '').toLowerCase()
  const allowed = allowGif ? ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] : ['image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(declared)) throw new Error('图片格式不受支持')
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error('图片最大 5MB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let actual = ''
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) actual = 'image/jpeg'
  else if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) actual = 'image/png'
  else if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') actual = 'image/webp'
  else if (bytes.length >= 6 && (String.fromCharCode(...bytes.slice(0, 6)) === 'GIF87a' || String.fromCharCode(...bytes.slice(0, 6)) === 'GIF89a')) actual = 'image/gif'
  if (!actual || !allowed.includes(actual) || actual !== declared) throw new Error('图片内容与声明的格式不一致')
  return actual
}

export async function uploadPageImage(env: Bindings, group: 'home' | 'city' | 'service', slug: string, file: File): Promise<ImageEntry> {
  const type = await validateImageFile(file)
  const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1]
  const safeGroup = group === 'home' ? 'home' : group + '/' + slug.replace(/[^a-z0-9_-]/gi, '_')
  const key = 'media/pages/' + safeGroup + '/' + crypto.randomUUID() + '.' + ext
  await env.R2_MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: type, contentDisposition: 'inline' },
    customMetadata: { purpose: 'page-image', group, slug, originalName: file.name },
  })
  return { url: '/media/' + key.slice('media/'.length), key, alt: file.name.slice(0, 120), updatedAt: new Date().toISOString() }
}

export async function deletePageImage(env: Bindings, current: ImageEntry | undefined): Promise<void> {
  if (current?.key) await env.R2_MEDIA.delete(current.key).catch(() => {})
}

export function removeImage(store: ImageStore, group: 'home' | 'cities' | 'services', slug?: string): ImageEntry | undefined {
  if (group === 'home') {
    const old = store.home
    delete store.home
    return old
  }
  const bucket = store[group]
  if (!slug) return undefined
  const old = bucket[slug]
  delete bucket[slug]
  return old
}
