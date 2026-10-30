import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerMentionsSite, summarizeCitations } from '../src/utils/geoCitations.ts'

test('detects a cited URL that belongs to the site', () => {
  const r = answerMentionsSite('可参考 https://example.com/article/x 的说明', 'Example', 'https://example.com')
  assert.equal(r.mentioned, true)
  assert.equal(r.citedUrl, 'https://example.com/article/x')
})

test('detects a brand-name mention without URL', () => {
  const r = answerMentionsSite('Example 提供相关服务', 'Example', 'https://example.com')
  assert.equal(r.mentioned, true)
  assert.equal(r.citedUrl, '')
})

test('does not match other domains or too-short names', () => {
  assert.equal(answerMentionsSite('见 https://other.org/a', 'Example', 'https://example.com').mentioned, false)
  assert.equal(answerMentionsSite('AI 工具', 'A', 'https://example.com').mentioned, false)
})

test('summarizes rates per platform sorted by rate', () => {
  const rows = summarizeCitations([
    { platform: 'deepseek', model: '', query: 'q', mentioned: true, citedUrl: '', checkedOn: '2026-10-12' },
    { platform: 'deepseek', model: '', query: 'q2', mentioned: false, citedUrl: '', checkedOn: '2026-10-12' },
    { platform: 'kimi', model: '', query: 'q', mentioned: true, citedUrl: '', checkedOn: '2026-10-12' },
  ])
  assert.equal(rows[0].platform, 'kimi')
  assert.equal(rows[0].rate, 100)
  assert.equal(rows[1].rate, 50)
})
