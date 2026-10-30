import test from 'node:test'
import assert from 'node:assert/strict'
import { decideNewsStatus, getNewsQualityThreshold, MIN_NEWS_QUALITY_SCORE, statusAfterAiDraft } from '../src/services/newsPipeline.ts'

test('quality-passing news remains pending until a human publishes it', () => {
  assert.equal(MIN_NEWS_QUALITY_SCORE, 65)
  assert.deepEqual(
    decideNewsStatus({ autoPublish: true, qualityScore: 65, checksPassed: true }),
    { status: 'pending_review', reason: 'human_review_required' },
  )
})

test('failed quality checks remain pending', () => {
  assert.deepEqual(
    decideNewsStatus({ autoPublish: true, qualityScore: 99, checksPassed: false }),
    { status: 'pending_review', reason: 'quality_checks_failed' },
  )
})

test('low-quality content remains pending', () => {
  assert.deepEqual(
    decideNewsStatus({ autoPublish: true, qualityScore: 64, checksPassed: true }),
    { status: 'pending_review', reason: 'quality_score_below_threshold' },
  )
})

test('AI-filled article content cannot be published directly', () => {
  assert.equal(statusAfterAiDraft('published'), 'pending_review')
  assert.equal(statusAfterAiDraft('pending_review'), 'pending_review')
  assert.equal(statusAfterAiDraft('draft'), 'draft')
})

test('getNewsQualityThreshold returns default when setting is absent or out of range', () => {
  assert.equal(getNewsQualityThreshold({}), MIN_NEWS_QUALITY_SCORE)
  assert.equal(getNewsQualityThreshold({ news_quality_min: '' }), MIN_NEWS_QUALITY_SCORE)
  assert.equal(getNewsQualityThreshold({ news_quality_min: 'not-a-number' }), MIN_NEWS_QUALITY_SCORE)
  assert.equal(getNewsQualityThreshold({ news_quality_min: '-1' }), MIN_NEWS_QUALITY_SCORE)
  assert.equal(getNewsQualityThreshold({ news_quality_min: '101' }), MIN_NEWS_QUALITY_SCORE)
})

test('getNewsQualityThreshold treats 0 as a valid configured value', () => {
  // 0 是合法门槛（不拦截任何内容），与“未配置”区分开。
  assert.equal(getNewsQualityThreshold({ news_quality_min: '0' }), 0)
})

test('decideNewsStatus respects a raised custom threshold', () => {
  assert.deepEqual(
    decideNewsStatus({ qualityScore: 70, checksPassed: true, minScore: 80 }),
    { status: 'pending_review', reason: 'quality_score_below_threshold' },
  )
})

test('decideNewsStatus passes when custom threshold is met', () => {
  assert.deepEqual(
    decideNewsStatus({ qualityScore: 80, checksPassed: true, minScore: 80 }),
    { status: 'pending_review', reason: 'human_review_required' },
  )
})

test('auto publish requires switch, quality and GEO gates together', () => {
  assert.equal(decideNewsStatus({ autoPublish: true, qualityScore: 80, checksPassed: true, geoPassed: true }).status, 'published')
  assert.equal(decideNewsStatus({ autoPublish: false, qualityScore: 80, checksPassed: true, geoPassed: true }).status, 'pending_review')
  assert.equal(decideNewsStatus({ autoPublish: true, qualityScore: 80, checksPassed: true, geoPassed: false }).status, 'pending_review')
  assert.equal(decideNewsStatus({ autoPublish: true, qualityScore: 40, checksPassed: true, geoPassed: true }).status, 'pending_review')
  assert.equal(decideNewsStatus({ autoPublish: true, qualityScore: 80, checksPassed: false, geoPassed: true }).status, 'pending_review')
})
