import test from 'node:test'
import assert from 'node:assert/strict'
import { isUtmSourceAllowed } from '../src/utils/utm.ts'

test('utm white-list: empty whitelist allows any source', () => {
  assert.equal(isUtmSourceAllowed('baidu-cpc', ''), true)
  assert.equal(isUtmSourceAllowed('', ''), true)
})

test('utm white-list: empty source is always allowed', () => {
  assert.equal(isUtmSourceAllowed('', 'baidu,google'), true)
})

test('utm white-list: source in whitelist is allowed (case-insensitive)', () => {
  assert.equal(isUtmSourceAllowed('baidu', 'baidu,google'), true)
  assert.equal(isUtmSourceAllowed('BAIDU', 'baidu,google'), true)
  assert.equal(isUtmSourceAllowed('Baidu', 'Baidu, Google'), true)
})

test('utm white-list: source not in whitelist is rejected', () => {
  assert.equal(isUtmSourceAllowed('evil', 'baidu,google'), false)
  assert.equal(isUtmSourceAllowed('bing', 'baidu, google, 360'), false)
})

test('utm white-list: supports Chinese and mixed separators', () => {
  assert.equal(isUtmSourceAllowed('微信', '微信,支付宝,抖音'), true)
  assert.equal(isUtmSourceAllowed('抖 音', '抖音,快手'), false)
})
