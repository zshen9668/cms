import test from 'node:test'
import assert from 'node:assert/strict'
import {
  listVersions, captureVersion, restoreVersion,
} from '../src/plugins/versioning/service.ts'

/** 最小 D1 shim:articles + article_versions 内存 CRUD */
function makeD1() {
  const rows: Record<string, any[]> = { articles: [], article_versions: [] }
  let aseq = 0, vseq = 0
  const db: any = {
    prepare(sql: string) {
      const m = sql.trim()
      const table = m.match(/INTO\s+(\w+)/i)?.[1] || m.match(/FROM\s+(\w+)/i)?.[1] || m.match(/UPDATE\s+(\w+)/i)?.[1] || null
      let curVals: any[] = []
      const filterVersions = (store: any[]) => {
        const tenantId = Number(curVals[0])
        const articleId = Number(curVals[1])
        const versionNumber = Number(curVals[2])
        return store.filter((r: any) => {
          if (r.tenant_id !== tenantId || r.article_id !== articleId) return false
          if (Number.isFinite(versionNumber)) return r.version_number === versionNumber
          return true
        })
      }
      const allImpl = async () => {
        if (!table) return { results: [] }
        const store = rows[table] || []
        if (/SELECT id, slug, category/i.test(m) && /FROM articles/i.test(m)) {
          return { results: store.filter((r: any) => r.id === Number(curVals[0])) }
        }
        if (/MAX\(version_number\)/i.test(m)) {
          const v = (rows.article_versions || []).filter((r: any) => r.article_id === Number(curVals[1]))
          return { results: [{ n: v.length ? Math.max(...v.map((x: any) => x.version_number)) : 0 }] }
        }
        if (table === 'article_versions') {
          if (/ORDER BY/i.test(m)) {
            return { results: filterVersions(store).sort((a: any, b: any) => b.version_number - a.version_number) }
          }
          return { results: filterVersions(store) }
        }
        return { results: store }
      }
      const firstImpl = async () => {
        const r = await allImpl()
        return (r as any).results[0] ?? null
      }
      const runImpl = async () => {
        if (!table) return { meta: { changes: 0 } }
        if (/INSERT INTO article_versions/i.test(m)) {
          const row = {
            id: ++vseq, tenant_id: curVals[0], article_id: curVals[1], version_number: curVals[2], root_id: curVals[3],
            title: curVals[4], slug: curVals[5], category: curVals[6], summary: curVals[7], content: curVals[8], status: curVals[9],
            seo_title: curVals[10], seo_description: curVals[11], seo_keywords: curVals[12], card_svg: curVals[13], cover_image: curVals[14],
            created_by: curVals[15], created_at: 'now',
          }
          ;(rows[table] ||= []).push(row)
          return { meta: { changes: 1, last_row_id: row.id } }
        }
        if (/UPDATE articles SET/i.test(m) && /WHERE id=\?/i.test(m)) {
          const target = (rows[table] || []).find((r: any) => r.id === Number(curVals[curVals.length - 2]))
          if (target) {
            target.title = curVals[0]; target.slug = curVals[1]; target.category = curVals[2]
            target.summary = curVals[3]; target.content = curVals[4]; target.status = curVals[5]
          }
          return { meta: { changes: target ? 1 : 0 } }
        }
        if (/UPDATE article_versions SET title/i.test(m)) {
          return { meta: { changes: 1 } }
        }
        if (/INSERT INTO articles/i.test(m)) {
          const row = { id: ++aseq, tenant_id: 1, slug: curVals[0], title: curVals[1], status: curVals[2] }
          ;(rows.articles ||= []).push(row)
          return { meta: { changes: 1, last_row_id: row.id } }
        }
        return { meta: { changes: 0 } }
      }
      return {
        all: allImpl, first: firstImpl, run: runImpl,
        bind(...vals: any[]) { curVals = vals; return { all: allImpl, first: firstImpl, run: runImpl } },
      }
    },
  }
  return { db, rows }
}

function seedArticle(shim: ReturnType<typeof makeD1>) {
  shim.rows.articles.push({
    id: 1, tenant_id: 1, slug: 's1', title: '原标题', category: 'c', summary: 's',
    content: '<p>原内容</p>', status: 'draft', seo_title: null, seo_description: null,
    seo_keywords: null, card_svg: null, cover_image: null,
  })
}

test('captureVersion 写入版本快照,版本号自增', async () => {
  const shim = makeD1()
  seedArticle(shim)
  const env: any = { DB: shim.db }
  await captureVersion(env, 1, 1)
  await captureVersion(env, 1, 1)
  assert.equal(shim.rows.article_versions.length, 2)
  assert.equal(shim.rows.article_versions[0].version_number, 1)
  assert.equal(shim.rows.article_versions[1].version_number, 2)
  assert.equal(shim.rows.article_versions[0].title, '原标题')
})

test('captureVersion 对不存在的文章不报错', async () => {
  const shim = makeD1()
  const env: any = { DB: shim.db }
  await captureVersion(env, 1, 999)
  assert.equal(shim.rows.article_versions.length, 0)
})

test('listVersions 按版本降序', async () => {
  const shim = makeD1()
  seedArticle(shim)
  const env: any = { DB: shim.db }
  await captureVersion(env, 1, 1)
  await captureVersion(env, 1, 1)
  await captureVersion(env, 1, 1)
  const versions = await listVersions(env, 1, 1)
  assert.equal(versions.length, 3)
  assert.equal(versions[0].version_number, 3)
  assert.equal(versions[2].version_number, 1)
})

test('restoreVersion 用旧快照覆盖 articles 行', async () => {
  const shim = makeD1()
  seedArticle(shim)
  const env: any = { DB: shim.db }
  await captureVersion(env, 1, 1)
  // 模拟文章被改过
  shim.rows.articles[0].title = '改过的标题'
  shim.rows.articles[0].status = 'published'
  await restoreVersion(env, 1, 1, 1)
  assert.equal(shim.rows.articles[0].title, '原标题')
  assert.equal(shim.rows.articles[0].status, 'draft')
})

test('restoreVersion 对不存在的版本抛错', async () => {
  const shim = makeD1()
  seedArticle(shim)
  const env: any = { DB: shim.db }
  await captureVersion(env, 1, 1)
  await assert.rejects(() => restoreVersion(env, 1, 1, 99), /版本不存在/)
})
