import { Hono } from 'hono'
import type { Bindings } from '../../types'
import type { CmsPlugin } from '../types'
import { rateLimit } from '../../middleware/security'
import { verifyTurnstile } from '../turnstile/index'
import { safeError, safeWarn } from '../../utils/safeLogger'
import { getTenantId } from '../../db/scoped'
import {
  listForms, getFormBySlug, upsertForm, validateSubmission, submitForm, parseFields,
  type FormFieldDef,
} from './service'
import { renderFormPage, renderFormAdminPage } from '../../templates/adminForms'
import { resolveAdminSiteName } from '../../utils/adminSiteName'

/**
 * 表单系统插件(移植 SonicJS forms-plugin)。
 * - 管理端:/admin/forms(HTML + JSON 建改表单;提交列表;CSV 导出)
 * - 公开端:POST /forms/:slug(限流 + honeypot + Turnstile 可选)
 * - 公开端:GET /forms/:slug(动态渲染表单页)
 */
const routes = new Hono<{ Bindings: Bindings }>()

// ---- 管理端(经 registry 挂载后由 /admin 全局 requireAdmin 拦截) ----
routes.get('/forms', async (c) => {
  try {
    const forms = await listForms(c.env)
    const submissions = (await c.env.DB.prepare(
      'SELECT s.id, s.form_id, s.payload, s.created_at, f.slug FROM form_submissions s LEFT JOIN form_schemas f ON f.id = s.form_id ORDER BY s.id DESC LIMIT 200',
    ).all()).results as any[]
    const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
    const cspNonce = (c as any).get('cspNonce') || ''
    const csrfToken = (c as any).get('csrfToken') || ''
    return c.html(renderFormAdminPage(forms, submissions, siteName, cspNonce, csrfToken))
  } catch (e) {
    safeError('forms admin page failed', e)
    return c.redirect('/admin/forms?error=' + encodeURIComponent('表单加载失败'))
  }
})

async function parseFormBody(body: Record<string, string | File>): Promise<{ slug: string; title: string; fields: FormFieldDef[]; enabled: boolean }> {
  const slug = String(body.form_slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64)
  const title = String(body.form_title || '').trim().slice(0, 120)
  const enabled = String(body.form_enabled || '1') !== '0'
  const fields: FormFieldDef[] = []
  const rawFields = String(body.form_fields || '').trim()
  if (rawFields) {
    try {
      const parsed = JSON.parse(rawFields)
      for (const f of (Array.isArray(parsed) ? parsed : [])) {
        if (f && typeof f.name === 'string') {
          fields.push({
            name: String(f.name).slice(0, 64),
            label: String(f.label || f.name).slice(0, 64),
            type: (['text', 'textarea', 'email', 'number', 'select', 'radio'].includes(String(f.type)) ? String(f.type) : 'text') as FormFieldDef['type'],
            required: f.required === true,
            options: Array.isArray(f.options) ? (f.options as unknown[]).map((o) => String(o)).slice(0, 50) : undefined,
          })
        }
      }
    } catch {
      throw new Error('form_fields 不是合法 JSON')
    }
  }
  if (!slug || !title) throw new Error('slug 与标题必填')
  if (!fields.length) throw new Error('至少需要 1 个字段')
  return { slug, title, fields, enabled }
}

routes.post('/forms/save', async (c) => {
  try {
    const body = (await c.req.parseBody()) as Record<string, string | File>
    const input = await parseFormBody(body)
    await upsertForm(c.env, input)
    return c.redirect('/admin/forms?ok=' + encodeURIComponent('表单已保存: ' + input.slug))
  } catch (e: any) {
    return c.redirect('/admin/forms?error=' + encodeURIComponent(String(e?.message || e || '保存失败')))
  }
})

routes.get('/forms/:slug/export.csv', async (c) => {
  try {
    const form = await getFormBySlug(c.env, c.req.param('slug'))
    if (!form) return c.notFound()
    const rows = (await c.env.DB.prepare('SELECT payload FROM form_submissions WHERE form_id = ? ORDER BY id DESC LIMIT 5000').bind(form.id).all()).results as any[]
    const fields = parseFields(form.fields)
    const header = fields.map((f) => f.name).join(',')
    let skippedRows = 0
    const lines = rows.map((r) => {
      // 逐行安全解析:历史上这里直接 JSON.parse,库里只要有**一行** payload 坏掉(截断/手工改废),
      // 整个导出就会抛异常并被路由级 catch 吞成「导出失败」,站长拿不到任何数据。
      // 现在坏行按空值处理,其余行照常导出,并在末尾统计跳过条数。
      let obj: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(String(r.payload || '{}'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>
      } catch {
        skippedRows++
      }
      return fields.map((f) => JSON.stringify(String(obj[f.name] ?? '').replace(/"/g, '""'))).join(',')
    })
    if (skippedRows) safeWarn('forms export skipped malformed payloads', { slug: form.slug, skippedRows })
    const csv = [header, ...lines].join('\n')
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="${form.slug}-submissions.csv"`)
    return c.text('﻿' + csv)
  } catch (e) {
    safeError('forms export failed', e)
    return c.redirect('/admin/forms?error=' + encodeURIComponent('导出失败'))
  }
})

// ---- 公开端(经 registry 挂载到应用根) ----
const publicRoutes = new Hono<{ Bindings: Bindings }>()

publicRoutes.get('/forms/:slug', async (c) => {
  const form = await getFormBySlug(c.env, c.req.param('slug'))
  if (!form) return c.notFound()
  return c.html(renderFormPage(form, parseFields(form.fields)))
})

publicRoutes.post('/forms/:slug', rateLimit(10, 60), async (c) => {
  const form = await getFormBySlug(c.env, c.req.param('slug'))
  if (!form) return c.json({ ok: false, error: '表单不存在' }, 404)
  const body = (await c.req.parseBody()) as Record<string, string | File>
  // honeypot:字段 "hp" 出现在 body 说明是机器人
  if (String(body.hp || '').trim()) return c.json({ ok: true }) // 静默成功
  // Turnstile:已配置时校验,未配置自动跳过
  const ts = await verifyTurnstile(c.env, 1, String(body['cf-turnstile-response'] || ''), c.req.header('cf-connecting-ip'))
  if (!ts.valid) return c.json({ ok: false, error: '人机校验失败' }, 403)
  const payload: Record<string, string> = {}
  for (const [k, v] of Object.entries(body)) {
    if (k === 'hp' || k === 'cf-turnstile-response') continue
    payload[k] = typeof v === 'string' ? v : ''
  }
  const { ok, error, clean } = validateSubmission(parseFields(form.fields), payload)
  if (!ok) return c.json({ ok: false, error })
  await submitForm(c.env, Number(form.id), clean, c.req.header('referer')?.slice(0, 200))
  return c.json({ ok: true })
})

export const formsPlugin: CmsPlugin = {
  id: 'forms',
  version: '1.0.0',
  mount(app) {
    app.route('/admin', routes)
    app.route('/', publicRoutes)
  },
}
