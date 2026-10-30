import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAiQaContext, extractSearchTerms, hashIp, normalizeAiQaSettings, parseAiQaSources,
  AI_QA_MAX_CONTEXT_CEILING, DEFAULT_AI_QA_MAX_CONTEXT_CHARS, DEFAULT_AI_QA_WELCOME,
} from '../src/utils/aiQa.ts'

/**
 * 极简 D1 stub：按 SQL 里出现的表名返回预置行，并记录 bind 实参，
 * 用于验证「每个查询都带上了 tenant_id」这条多租户红线。
 * 形如 `{ DB: ... }`——buildAiQaContext 的第一道守卫就是 `env.DB` 是否存在。
 */
function stubDb(rows: { articles?: any[]; services?: any[]; cities?: any[]; cases?: any[] }) {
  const binds: unknown[][] = []
  return {
    DB: {
      prepare(sql: string) {
        const table = /FROM articles/.test(sql) ? 'articles'
          : /FROM services/.test(sql) ? 'services'
          : /FROM cities/.test(sql) ? 'cities'
          : /FROM cases/.test(sql) ? 'cases'
          : 'unknown'
        return {
          bind(...args: unknown[]) {
            binds.push(args)
            const results = (rows as any)[table] || []
            return {
              all: async () => ({ results }),
              first: async () => results[0] ?? null,
              run: async () => ({ success: true }),
            }
          },
        }
      },
    },
    _binds: binds,
  }
}

// ---------------------------------------------------------------------------
// 检索词提取
// ---------------------------------------------------------------------------

test('extractSearchTerms splits punctuation and adds sliding windows for Chinese', () => {
  const terms = extractSearchTerms('你们在深圳有公司注册服务吗？')
  assert.ok(terms.includes('深圳'), '应包含完整短语切分出的词')
  assert.ok(terms.length > 1)
  assert.ok(terms.length <= 8, '必须受 limit 限制，避免单次检索打过多 LIKE')
  assert.ok(terms.every((term) => term.length >= 2), '单字词检索噪声太大，必须被丢弃')
})

test('extractSearchTerms keeps English words and drops empties', () => {
  const terms = extractSearchTerms('How much does SEO audit cost?')
  assert.ok(terms.includes('How much does SEO audit cost') || terms.includes('SEO'))
  assert.ok(terms.every((term) => term.trim().length >= 2))
  assert.deepEqual(extractSearchTerms('   '), [])
  assert.deepEqual(extractSearchTerms(''), [])
})

test('extractSearchTerms strips LIKE wildcards so a question cannot match the whole table', () => {
  const terms = extractSearchTerms('100%_off \\ all')
  assert.ok(terms.length > 0)
  assert.ok(terms.every((term) => !/[%_\\]/.test(term)), '通配符必须被剔除: ' + JSON.stringify(terms))
})

// ---------------------------------------------------------------------------
// 站内检索（RAG 的检索半段）
// ---------------------------------------------------------------------------

test('buildAiQaContext returns sources with public paths and tenant-scoped queries', async () => {
  const db = stubDb({
    articles: [{ title: '深圳公司注册流程', slug: 'shenzhen-register', summary: '流程说明', body: '<p>正文内容</p>' }],
    services: [{ name: '公司注册', slug: 'register', summary: '注册服务' }],
    cities: [{ name: '深圳', slug: 'shenzhen', province: '广东省' }],
    cases: [{ client_name: '某科技公司', slug: 'tech-co', industry: '互联网', region: '深圳', summary: '交付案例', challenge: '挑战', solution: '方案', results: '成果' }],
  })

  const context = await buildAiQaContext(db as any, 7, '深圳公司注册怎么办理？', 4000)

  const byPath = new Map(context.sources.map((s) => [s.path, s]))
  assert.equal(byPath.get('/article/shenzhen-register')?.type, 'article')
  assert.equal(byPath.get('/service/register')?.type, 'service')
  assert.equal(byPath.get('/city/shenzhen')?.type, 'city')
  assert.equal(byPath.get('/case/tech-co')?.type, 'case')
  assert.ok(context.contextText.includes('深圳公司注册流程'))
  assert.ok(context.contextText.includes('/case/tech-co'))

  // 多租户红线：每条查询都必须把 tenant_id 作为第一个绑定参数
  assert.equal(db._binds.length, 4)
  for (const args of db._binds) {
    assert.equal(args[0], 7, '查询缺少 tenant_id 绑定: ' + JSON.stringify(args))
  }
})

test('buildAiQaContext returns nothing for an empty question without touching D1', async () => {
  const db = stubDb({ articles: [{ title: 'x', slug: 'y', summary: 'z', body: 'w' }] })
  const context = await buildAiQaContext(db as any, 1, '   ')
  assert.deepEqual(context.sources, [])
  assert.equal(context.contextText, '')
  assert.equal(db._binds.length, 0)
})

test('buildAiQaContext never advertises a source the model did not actually see', async () => {
  const db = stubDb({
    articles: [
      { title: '甲文章标题', slug: 'a', summary: '甲', body: '甲正文' },
      { title: '乙文章标题', slug: 'b', summary: '乙', body: '乙正文' },
      { title: '丙文章标题', slug: 'c', summary: '丙', body: '丙正文' },
      { title: '丁文章标题', slug: 'd', summary: '丁', body: '丁正文' },
    ],
  })
  // 上限只够放下第一条：返回的 sources 必须同步收缩，否则就是"假引用"
  const context = await buildAiQaContext(db as any, 1, '甲文章标题', 40)
  const lines = context.contextText ? context.contextText.split('\n') : []
  assert.equal(context.sources.length, lines.length)
  assert.ok(context.sources.length < 4)
})

test('buildAiQaContext skips rows without a slug or title instead of emitting broken links', async () => {
  const db = stubDb({
    services: [{ name: '', slug: 'no-title', summary: 'x' }, { name: '有标题', slug: '', summary: 'y' }],
    cities: [{ name: '深圳', slug: '', province: '广东' }],
    cases: [{ client_name: '', industry: '', slug: 'ghost', summary: 'z' }],
  })
  const context = await buildAiQaContext(db as any, 1, '深圳有标题吗', 4000)
  assert.deepEqual(context.sources, [])
})

test('buildAiQaContext treats a failing table as empty (问答不能因为一张表异常就整体失败)', async () => {
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return { all: async () => { throw new Error('no such table: cases') } }
          },
        }
      },
    },
  }
  const context = await buildAiQaContext(env as any, 1, '公司注册', 4000)
  assert.deepEqual(context.sources, [])
  assert.equal(context.contextText, '')
})

// ---------------------------------------------------------------------------
// 设置归一化
// ---------------------------------------------------------------------------

test('normalizeAiQaSettings defaults to enabled with a welcome message', () => {
  const settings = normalizeAiQaSettings({})
  assert.equal(settings.enabled, true)
  assert.equal(settings.wecomAutoReply, true)
  assert.equal(settings.welcome, DEFAULT_AI_QA_WELCOME)
  assert.equal(settings.maxContextChars, DEFAULT_AI_QA_MAX_CONTEXT_CHARS)
  assert.equal(settings.prompt, '')
})

test('normalizeAiQaSettings honours explicit switches and clamps the context budget', () => {
  const settings = normalizeAiQaSettings({
    enabled: false,
    wecomAutoReply: false,
    welcome: '  你好  ',
    maxContextChars: 999999,
    prompt: 'x'.repeat(9999),
  })
  assert.equal(settings.enabled, false)
  assert.equal(settings.wecomAutoReply, false)
  assert.equal(settings.welcome, '你好')
  assert.equal(settings.maxContextChars, AI_QA_MAX_CONTEXT_CEILING)
  assert.equal(settings.prompt.length, 4000)

  assert.equal(normalizeAiQaSettings({ maxContextChars: 1 }).maxContextChars, 800)
  assert.equal(normalizeAiQaSettings({ maxContextChars: 'abc' }).maxContextChars, DEFAULT_AI_QA_MAX_CONTEXT_CHARS)
})

// ---------------------------------------------------------------------------
// 留痕解析
// ---------------------------------------------------------------------------

test('parseAiQaSources tolerates broken JSON and unknown types', () => {
  assert.deepEqual(parseAiQaSources('not json'), [])
  assert.deepEqual(parseAiQaSources('{"a":1}'), [])
  assert.deepEqual(parseAiQaSources(null), [])

  const parsed = parseAiQaSources(JSON.stringify([
    { type: 'article', title: '标题', path: '/article/a', excerpt: '摘要' },
    { type: 'unknown-type', title: '别的类型', path: '/x' },
    { type: '', title: '', path: '' },
    'not-an-object',
  ]))
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0]?.type, 'article')
  // 未知类型归一为 article，但标题仍保留，避免后台列表出现空白
  assert.equal(parsed[1]?.type, 'article')
  assert.equal(parsed[1]?.title, '别的类型')
})

test('parseAiQaSources caps the list so a huge log row cannot blow up the admin page', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ type: 'article', title: 't' + i, path: '/p/' + i }))
  assert.equal(parseAiQaSources(JSON.stringify(many)).length, 10)
})

// ---------------------------------------------------------------------------
// IP 哈希（不落明文）
// ---------------------------------------------------------------------------

test('hashIp is deterministic, truncated and never returns the raw IP', async () => {
  const first = await hashIp('203.0.113.9')
  const second = await hashIp('203.0.113.9')
  assert.equal(first, second)
  assert.equal(first.length, 32)
  assert.match(first, /^[0-9a-f]{32}$/)
  assert.ok(!first.includes('203'))
  assert.notEqual(first, await hashIp('203.0.113.10'))
  assert.equal(await hashIp(''), '')
})
