import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseFields, validateSubmission, upsertForm, getFormBySlug, listForms,
} from '../src/plugins/forms/service.ts'

/** 最小 D1 shim:form_schemas / form_submissions 内存 CRUD */
function makeD1() {
  const rows: Record<string, any[]> = { form_schemas: [], form_submissions: [] }
  let seq = 0
  const db: any = {
    prepare(sql: string) {
      const m = sql.trim()
      // UPDATE 没有 INTO/FROM,直接从 UPDATE 子句取表名
      const table = m.match(/INTO\s+(\w+)/i)?.[1] || m.match(/FROM\s+(\w+)/i)?.[1] || m.match(/UPDATE\s+(\w+)/i)?.[1] || null
      let curVals: any[] = []
      const allImpl = async () => {
        if (!table) return { results: [] }
        const store = rows[table] || []
        if (/WHERE slug = \? AND enabled/i.test(m)) {
          return { results: store.filter((r: any) => r.slug === curVals[0] && Number(r.enabled) === 1) }
        }
        if (/WHERE slug = \?/i.test(m)) {
          return { results: store.filter((r: any) => r.slug === curVals[0]) }
        }
        if (/WHERE form_id = \?/i.test(m)) {
          return { results: store.filter((r: any) => Number(r.form_id) === Number(curVals[0])) }
        }
        return { results: store }
      }
      const firstImpl = async () => {
        if (/INSERT INTO/i.test(m) && /RETURNING/i.test(m)) {
          const row = table === 'form_schemas'
            ? { id: ++seq, tenant_id: 1, slug: curVals[0], title: curVals[1], fields: curVals[2], enabled: curVals[3] ?? 1 }
            : { id: ++seq, tenant_id: 1, form_id: curVals[0], payload: curVals[1], source: curVals[2] }
          ;(rows[table] ||= []).push(row)
          return row
        }
        const r = await allImpl()
        return (r as any).results[0] ?? null
      }
      const runImpl = async () => {
        if (!table) return { meta: { changes: 0 } }
        if (/INSERT INTO form_schemas/i.test(m)) {
          const row = { id: ++seq, tenant_id: 1, slug: curVals[0], title: curVals[1], fields: curVals[2], enabled: curVals[3] ?? 1 }
          ;(rows[table] ||= []).push(row)
          return { meta: { changes: 1, last_row_id: row.id } }
        }
        if (/INSERT INTO form_submissions/i.test(m)) {
          const row = { id: ++seq, tenant_id: 1, form_id: curVals[0], payload: curVals[1], source: curVals[2] }
          ;(rows[table] ||= []).push(row)
          return { meta: { changes: 1, last_row_id: row.id } }
        }
        if (/UPDATE form_schemas/i.test(m)) {
          const target = (rows[table] || []).find((r: any) => r.id === Number(curVals[3]))
          if (target) {
            target.title = curVals[0]; target.fields = curVals[1]; target.enabled = curVals[2]
          }
          return { meta: { changes: target ? 1 : 0 } }
        }
        return { meta: { changes: 0 } }
      }
      // D1 允许直接对 statement 调 .all()/.first()/.run()(无参数),也允许 .bind(...).all()
      return {
        all: allImpl, first: firstImpl, run: runImpl,
        bind(...vals: any[]) {
          curVals = vals
          return { all: allImpl, first: firstImpl, run: runImpl }
        },
      }
    },
  }
  return { db, rows }
}

test('parseFields: 合法 JSON 数组 → 规范化字段定义', () => {
  const raw = JSON.stringify([
    { name: 'name', label: '姓名', type: 'text', required: true },
    { name: 'city', type: 'select', options: ['北京', '上海'] },
    { name: 'bad', label: 'x' },
    { no_name: 1 },
  ])
  const fields = parseFields(raw)
  assert.equal(fields.length, 3)
  assert.equal(fields[0].type, 'text')
  assert.equal(fields[0].required, true)
  assert.deepEqual(fields[1].options, ['北京', '上海'])
  assert.equal(fields[2].type, 'text')
})

test('parseFields: 非法 JSON / 非数组 → 空数组', () => {
  assert.deepEqual(parseFields('not json'), [])
  assert.deepEqual(parseFields('{}'), [])
})

test('validateSubmission: 必填缺失/格式错/取值无效/未定义字段丢弃', () => {
  const fields = parseFields(JSON.stringify([
    { name: 'email', label: '邮箱', type: 'email', required: true },
    { name: 'city', label: '城市', type: 'select', options: ['北京', '上海'] },
  ]))
  assert.equal(validateSubmission(fields, { city: '北京' }).ok, false, '必填 email 缺失')
  assert.equal(validateSubmission(fields, { email: 'bad', city: '北京' }).ok, false, '邮箱格式错')
  assert.equal(validateSubmission(fields, { email: 'a@b.com', city: '广州' }).ok, false, 'select 取值无效')
  const ok = validateSubmission(fields, { email: 'a@b.com', city: '北京', hacker: 'x' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.clean, { email: 'a@b.com', city: '北京' })
})

test('upsertForm: 新 slug 创建 / 已有 slug 更新', async () => {
  const shim = makeD1()
  const env: any = { DB: shim.db }
  const fields = [{ name: 'name', type: 'text' }]

  const newId = await upsertForm(env, { slug: 'quote', title: '询价', fields, enabled: true })
  assert.equal(newId, 1)

  const again = await upsertForm(env, { slug: 'quote', title: '询价v2', fields, enabled: true })
  assert.equal(again, 1, '同 slug 应更新而非新建')
  assert.equal(shim.rows.form_schemas.length, 1)

  // getFormBySlug 要求 enabled = 1
  const found = await getFormBySlug(env, 'quote')
  assert.ok(found, 'enabled=1 时应能查到')
  assert.equal(found?.title, '询价v2')
  assert.equal(shim.rows.form_schemas[0].title, '询价v2')

  const listed = await listForms(env)
  assert.equal(listed.length, 1)
})
