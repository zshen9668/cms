import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArticleFaq, faqPageJsonLd, buildFaqJsonFromBody, hasFaqEditorFields } from '../src/utils/articleSchema.ts'

test('parses FAQ JSON string and drops incomplete items', () => {
  const raw = JSON.stringify([{ q: '怎么办?', a: '先核验材料。' }, { q: '', a: '无问题' }, { question: '多久?', answer: '约五个工作日。' }])
  const items = parseArticleFaq(raw)
  assert.deepEqual(items.map((i) => i.q), ['怎么办?', '多久?'])
})

test('returns empty for invalid or missing FAQ', () => {
  assert.deepEqual(parseArticleFaq(''), [])
  assert.deepEqual(parseArticleFaq('not json'), [])
  assert.deepEqual(parseArticleFaq(null), [])
})

test('caps FAQ at eight items', () => {
  const raw = Array.from({ length: 12 }, (_, i) => ({ q: 'Q' + i, a: 'A' + i }))
  assert.equal(parseArticleFaq(raw).length, 8)
})

test('builds FAQPage JSON-LD only when items exist', () => {
  assert.equal(faqPageJsonLd([]), null)
  const ld = faqPageJsonLd([{ q: 'Q', a: 'A' }]) as any
  assert.equal(ld['@type'], 'FAQPage')
  assert.equal(ld.mainEntity[0].acceptedAnswer.text, 'A')
})

// 回归测试：后台表单曾用重复的同名字段 faq_q / faq_a 提交多组问答，
// 而 Hono 的 parseBody 默认对重复键只保留最后一个值，导致前面几组被静默丢掉。
// 现在字段名带索引（faq_q_0 / faq_a_0），这些用例锁住该行为。
test('builds faq_json from indexed form fields and tolerates index gaps', () => {
  const body = {
    faq_editor: '1',
    faq_q_0: '问题一', faq_a_0: '答案一',
    // 索引 1 缺失：用户删掉了中间那一组，索引不再连续
    faq_q_2: '问题二', faq_a_2: '答案二',
  }
  assert.deepEqual(JSON.parse(buildFaqJsonFromBody(body)), [
    { q: '问题一', a: '答案一' },
    { q: '问题二', a: '答案二' },
  ])
})

test('drops FAQ pairs where either side is empty', () => {
  const body = { faq_q_0: '有问无答', faq_a_0: '', faq_q_1: '', faq_a_1: '有答无问', faq_q_2: '完整', faq_a_2: '完整答案' }
  assert.deepEqual(JSON.parse(buildFaqJsonFromBody(body)), [{ q: '完整', a: '完整答案' }])
})

test('returns empty string when no complete FAQ pair is submitted', () => {
  assert.equal(buildFaqJsonFromBody({ faq_editor: '1' }), '')
  assert.equal(buildFaqJsonFromBody({}), '')
})

test('caps FAQ at eight pairs even with more indexed fields', () => {
  const body: Record<string, string> = {}
  for (let i = 0; i < 12; i++) { body[`faq_q_${i}`] = `Q${i}`; body[`faq_a_${i}`] = `A${i}` }
  assert.equal((JSON.parse(buildFaqJsonFromBody(body)) as unknown[]).length, 8)
})

test('distinguishes the FAQ editor form from other entry points', () => {
  // 只有带隐藏标记的提交才算「用户操作过 FAQ」。
  // AI 预览、AI 发布等入口没有该字段，必须保留数据库里已有的问答，否则会被静默清空。
  assert.equal(hasFaqEditorFields({ faq_editor: '1' }), true)
  assert.equal(hasFaqEditorFields({ faq_q_0: 'x', faq_a_0: 'y' }), false)
  assert.equal(hasFaqEditorFields({}), false)
})

test('trims and truncates FAQ field values', () => {
  const body = { faq_q_0: '  问题  ', faq_a_0: '  ' + 'x'.repeat(1200) + '  ' }
  const parsed = JSON.parse(buildFaqJsonFromBody(body)) as Array<{ q: string; a: string }>
  assert.equal(parsed[0]!.q, '问题')
  assert.equal(parsed[0]!.a.length, 1000)
})
