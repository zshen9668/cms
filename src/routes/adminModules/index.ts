import { Hono } from 'hono'
import type { Bindings } from '../../types'
import { requireAdmin } from '../../middleware/authGuard'
import { requireRbac } from '../../middleware/rbac'
import { contactAdminRoutes } from './contact'
import { languageAdminRoutes } from './languages'
import { navigationAdminRoutes } from './navigation'
import { getContactAdmin, updateContactAdmin } from '../../modules/adminManagers/contactAdmin'
import { updateNavigationAdmin } from '../../modules/adminManagers/navigationAdmin'
import { updateLanguageAdmin } from '../../modules/adminManagers/languageAdmin'
import { purgeCacheAll } from '../../middleware/cache'
import type { ContactChannel } from '../../modules/contactChannels'
import type { NavigationItem } from '../../modules/navigation/service'
import type { LanguageOption } from '../../modules/languageManager'

/**
 * Modular admin under /admin/modules/*
 * - GET /admin/modules          跳转到 /admin/pages?tab=modules（页面管理已统一入口）
 * - GET/POST /admin/modules/contact|languages|navigation  JSON API
 * - POST .../form               HTML 表单提交
 */
export const adminModuleRoutes = new Hono<{ Bindings: Bindings }>()

adminModuleRoutes.use('*', requireAdmin)

// 同 admin.ts 上的角色模块权限：受限角色的 /admin/modules/* 读写也受模块权限控制。
adminModuleRoutes.use('*', requireRbac())

// 导航与联系已并入「页面管理」的导航与联系分页签；旧地址保留为跳转。
adminModuleRoutes.get('/', (c) => {
  const qs = new URL(c.req.url).search
  return c.redirect('/admin/pages?tab=modules' + (qs ? '&' + qs.slice(1) : ''))
})

function boolField(body: Record<string, string | File>, key: string, defaultValue = false): boolean {
  if (!(key in body)) return defaultValue
  const value = String(body[key] || '').toLowerCase()
  return value === '1' || value === 'on' || value === 'true' || value === 'yes'
}


async function uploadContactQr(env: Bindings, file: File | undefined): Promise<string | undefined> {
  if (!file || file.size <= 0) return undefined
  const allowed = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
  ])
  const ext = allowed.get(file.type)
  if (!ext) throw new Error('二维码仅支持 JPG、PNG、WEBP、GIF')
  if (file.size > 2 * 1024 * 1024) throw new Error('二维码文件最大 2MB')
  if (!env.R2_MEDIA) throw new Error('R2 媒体存储未绑定，无法上传二维码')
  const key = 'media/contact/' + crypto.randomUUID() + '.' + ext
  await env.R2_MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, contentDisposition: 'inline' },
    customMetadata: { purpose: 'contact-channel-qr', originalName: file.name.slice(0, 120) },
  })
  return '/media/' + key.slice('media/'.length)
}

function r2KeyFromMediaUrl(value: unknown): string | undefined {
  const raw = String(value || '').trim()
  if (!raw.startsWith('/media/')) return undefined
  const key = raw.slice('/media/'.length)
  if (!key || key.includes('..') || !key.startsWith('contact/')) return undefined
  return 'media/' + key
}

async function deleteContactQrObjects(env: Bindings, channels: ContactChannel[], retainedChannels: ContactChannel[] = []) {
  if (!env.R2_MEDIA) return
  const retained = new Set(
    retainedChannels.map((item) => r2KeyFromMediaUrl(item.qrUrl)).filter(Boolean) as string[],
  )
  const keys = [...new Set(
    channels.map((item) => r2KeyFromMediaUrl(item.qrUrl)).filter(Boolean) as string[],
  )].filter((key) => !retained.has(key))
  if (!keys.length) return
  await Promise.all(keys.map((key) => env.R2_MEDIA.delete(key).catch(() => {})))
}

async function formContacts(env: Bindings, body: Record<string, string | File>, previous: ContactChannel[]): Promise<ContactChannel[]> {
  const count = Math.min(50, Math.max(0, Number(body.contact_count) || 0))
  const items: ContactChannel[] = []
  for (let i = 0; i < count; i++) {
    const id = String(body[`c_id_${i}`] || '').trim() || String(Date.now()) + '-' + i
    const value = String(body[`c_value_${i}`] || '').trim()
    const label = String(body[`c_label_${i}`] || '').trim()
    if (!value && !label) continue
    const uploadedQr = await uploadContactQr(env, body[`c_qr_file_${i}`] instanceof File ? body[`c_qr_file_${i}`] as File : undefined)
    items.push({
      id,
      type: (String(body[`c_type_${i}`] || 'custom') as ContactChannel['type']) || 'custom',
      label: label.slice(0, 40),
      value: value.slice(0, 200),
      enabled: boolField(body, `c_enabled_${i}`, true),
      sortOrder: Number(body[`c_sort_${i}`]) || i + 1,
      openUrl: String(body[`c_open_${i}`] || '').trim().slice(0, 300) || undefined,
      locale: String(body[`c_locale_${i}`] || 'all').trim().slice(0, 20) || 'all',
      qrUrl: uploadedQr || String(body[`c_qr_${i}`] || '').trim().slice(0, 500) || undefined,
      display: {
        header: boolField(body, `c_header_${i}`),
        footer: boolField(body, `c_footer_${i}`, true),
        contact: boolField(body, `c_contact_${i}`, true),
        ai: boolField(body, `c_ai_${i}`, true),
      },
    })
  }
  await deleteContactQrObjects(env, previous.filter((old) => !items.some((next) => next.id === old.id && next.qrUrl === old.qrUrl)), items)
  return items.sort((a, b) => a.sortOrder - b.sortOrder)
}

function formNavigation(body: Record<string, string | File>): NavigationItem[] {
  const count = Math.min(20, Math.max(0, Number(body.nav_count) || 0))
  const items: NavigationItem[] = []
  for (let i = 0; i < count; i++) {
    const key = String(body[`n_key_${i}`] || '').trim()
    const path = String(body[`n_path_${i}`] || '').trim()
    if (!key || !path) continue
    const bottom = body[`n_bottom_${i}`] === '1' || body[`n_bottom_${i}`] === 'on'
    items.push({
      key,
      path,
      label: String(body[`n_label_${i}`] || '').trim().slice(0, 50) || key,
      enabled: body[`n_enabled_${i}`] === '1' || body[`n_enabled_${i}`] === 'on',
      sortOrder: Number(body[`n_sort_${i}`]) || i + 1,
      mobileOrder: Number(body[`n_mobile_${i}`]) || i + 1,
      bottom,
      // group 与「底部栏」勾选保持一致：勾了就进底部栏（primary），
      // 没勾就归到「更多」抽屉。表单里没有独立的 group 字段，
      // 之前不写 group 会让保存值缺字段、读回时退回默认值。
      group: bottom ? 'primary' : 'more',
    })
  }
  return items
}

function formLanguages(body: Record<string, string | File>): LanguageOption[] {
  const count = Math.min(10, Math.max(0, Number(body.lang_count) || 0))
  const defaultIdx = Number(body.l_default)
  const items: LanguageOption[] = []
  for (let i = 0; i < count; i++) {
    const code = String(body[`l_code_${i}`] || '').trim()
    if (!code) continue
    items.push({
      code,
      name: String(body[`l_name_${i}`] || code).trim().slice(0, 40),
      enabled: body[`l_enabled_${i}`] === '1' || body[`l_enabled_${i}`] === 'on',
      default: defaultIdx === i,
    })
  }
  if (!items.some((x) => x.default) && items.length > 0) {
    const first = items[0]
    if (first) first.default = true
  }
  return items
}

adminModuleRoutes.post('/contact/form', async (c) => {
  try {
    const body = (await c.req.parseBody()) as Record<string, string | File>
    const previous = await getContactAdmin(c.env)
    await updateContactAdmin(c.env, await formContacts(c.env, body, previous))
    return c.redirect('/admin/pages?tab=modules&ok=' + encodeURIComponent('联系方式已保存'))
  } catch (e: any) {
    return c.redirect('/admin/pages?tab=modules&error=' + encodeURIComponent(String(e?.message || e || '保存失败')))
  }
})

adminModuleRoutes.post('/navigation/form', async (c) => {
  try {
    const body = (await c.req.parseBody()) as Record<string, string | File>
    await updateNavigationAdmin(c.env, formNavigation(body))
    return c.redirect('/admin/pages?tab=modules&ok=' + encodeURIComponent('导航已保存'))
  } catch (e: any) {
    return c.redirect('/admin/pages?tab=modules&error=' + encodeURIComponent(String(e?.message || e || '保存失败')))
  }
})

adminModuleRoutes.post('/languages/form', async (c) => {
  try {
    const body = (await c.req.parseBody()) as Record<string, string | File>
    await updateLanguageAdmin(c.env, formLanguages(body))
    // 语言设置变更后立即清 CDN 缓存，让前台语言切换器 / hreflang 变更即时生效。
    c.executionCtx.waitUntil(purgeCacheAll(c.executionCtx))
    return c.redirect('/admin/pages?tab=modules&ok=' + encodeURIComponent('语言设置已保存'))
  } catch (e: any) {
    return c.redirect('/admin/pages?tab=modules&error=' + encodeURIComponent(String(e?.message || e || '保存失败')))
  }
})

adminModuleRoutes.route('/contact', contactAdminRoutes)
adminModuleRoutes.route('/languages', languageAdminRoutes)
adminModuleRoutes.route('/navigation', navigationAdminRoutes)
