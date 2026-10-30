import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HUMAN_REVIEW_PUBLICATION_MODE,
  PUBLICATION_PIPELINE,
  breadcrumbJsonLd,
  escapeLike,
  pageDocumentTitle,
  safeInternalPath,
} from '../src/utils/geo.ts'

test('publication mode is always human review', () => {
  assert.match(HUMAN_REVIEW_PUBLICATION_MODE, /人工审核/)
  assert.ok(PUBLICATION_PIPELINE.includes('pending_review'))
  assert.ok(PUBLICATION_PIPELINE.includes('IndexNow'))
})

test('escapeLike escapes SQL LIKE wildcards', () => {
  assert.equal(escapeLike('100%_off'), '100\\%\\_off')
  assert.equal(escapeLike('plain'), 'plain')
})

test('pageDocumentTitle joins title and site name', () => {
  assert.equal(pageDocumentTitle('首页', '示例站'), '首页 - 示例站')
  assert.equal(pageDocumentTitle('示例站', '示例站'), '示例站')
  assert.equal(pageDocumentTitle('', ''), '网站内容平台')
})

test('safeInternalPath blocks open redirects', () => {
  assert.equal(safeInternalPath('/city/beijing'), '/city/beijing')
  assert.equal(safeInternalPath('//evil.example'), '/')
  assert.equal(safeInternalPath('https://evil.example'), '/')
  assert.equal(safeInternalPath('/path?x=1'), '/path?x=1')
  assert.equal(safeInternalPath('\\evil'), '/')
})

test('breadcrumbJsonLd builds schema list', () => {
  const data = breadcrumbJsonLd('https://example.com', [
    { name: 'Home', path: '/' },
    { name: 'City', path: '/city' },
  ])
  assert.equal(data['@type'], 'BreadcrumbList')
  assert.equal(data.itemListElement.length, 2)
  assert.equal(data.itemListElement[1].item, 'https://example.com/city')
})
