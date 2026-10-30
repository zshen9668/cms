import type { Bindings } from '../../types'

export type FormFieldDef = {
  name: string
  label: string
  type: 'text' | 'textarea' | 'email' | 'number' | 'select' | 'radio'
  required?: boolean
  options?: string[]
}

export type FormSchemaRow = {
  id: number
  tenant_id: number
  slug: string
  title: string
  fields: string
  enabled: number
  [key: string]: unknown
}

export function parseFields(raw: string): FormFieldDef[] {
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((f) => f && typeof f.name === 'string' && f.name.length > 0)
      .map((f) => ({
        name: String(f.name).slice(0, 64),
        label: String(f.label || f.name).slice(0, 64),
        type: (['text', 'textarea', 'email', 'number', 'select', 'radio'].includes(String(f.type)) ? String(f.type) : 'text') as FormFieldDef['type'],
        required: f.required === true,
        options: Array.isArray(f.options) ? (f.options as unknown[]).map((o) => String(o).slice(0, 120)).slice(0, 50) : undefined,
      }))
  } catch {
    return []
  }
}

export async function listForms(env: Bindings): Promise<FormSchemaRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM form_schemas ORDER BY id DESC',
  ).all()
  return (results || []) as unknown as FormSchemaRow[]
}

export async function getFormBySlug(env: Bindings, slug: string): Promise<FormSchemaRow | null> {
  const row = (await env.DB.prepare('SELECT * FROM form_schemas WHERE slug = ? AND enabled = 1').bind(slug).first()) as any
  return row || null
}

export async function upsertForm(env: Bindings, input: { slug: string; title: string; fields: FormFieldDef[]; enabled: boolean }): Promise<number> {
  const fieldsJson = JSON.stringify(input.fields)
  const existing = (await env.DB.prepare('SELECT id FROM form_schemas WHERE slug = ?').bind(input.slug).first()) as any
  if (existing?.id) {
    await env.DB.prepare("UPDATE form_schemas SET title=?, fields=?, enabled=?, updated_at=datetime('now') WHERE id=?")
      .bind(input.title, fieldsJson, input.enabled ? 1 : 0, Number(existing.id)).run()
    return Number(existing.id)
  }
  const inserted = await env.DB.prepare('INSERT INTO form_schemas (slug, title, fields, enabled) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(input.slug, input.title, fieldsJson, input.enabled ? 1 : 0).first() as any
  return Number(inserted?.id)
}

/** 校验提交载荷:按字段定义过滤,未定义字段丢弃;required 缺失则拒绝 */
export function validateSubmission(fields: FormFieldDef[], payload: Record<string, string>): { ok: boolean; error?: string; clean: Record<string, string> } {
  const clean: Record<string, string> = {}
  for (const field of fields) {
    const raw = String(payload[field.name] ?? '').trim()
    if (field.required && !raw) return { ok: false, error: '缺少必填字段: ' + field.label, clean }
    if (field.type === 'email' && raw) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { ok: false, error: '邮箱格式不正确', clean }
    }
    if (field.type === 'select' || field.type === 'radio') {
      if (raw && field.options && !field.options.includes(raw)) return { ok: false, error: field.label + ' 取值无效', clean }
    }
    clean[field.name] = raw.slice(0, 2000)
  }
  return { ok: true, clean }
}

export async function submitForm(env: Bindings, formId: number, payload: Record<string, string>, source?: string): Promise<void> {
  await env.DB.prepare('INSERT INTO form_submissions (form_id, payload, source) VALUES (?, ?, ?)')
    .bind(formId, JSON.stringify(payload), source || null).run()
}
