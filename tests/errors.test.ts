import test from 'node:test'
import assert from 'node:assert/strict'
import { errorMessage } from '../src/utils/errors.ts'

test('formats Error instances', () => {
  assert.equal(errorMessage(new Error('boom')), 'boom')
})

test('formats strings and null safely', () => {
  assert.equal(errorMessage('boom'), 'boom')
  assert.equal(errorMessage(null, 'fallback'), 'fallback')
})

test('formats plain objects without throwing', () => {
  assert.equal(errorMessage({ code: 42 }), '{"code":42}')
})
