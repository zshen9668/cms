import test from 'node:test'
import assert from 'node:assert/strict'
import { signToken, verifyToken } from '../src/utils/auth.ts'

test('signToken and verifyToken round-trip', async () => {
  const secret = 'test-secret-key-at-least-32-chars!!'
  const token = await signToken({ uid: 42, email: 'admin@example.com' }, secret, 3600)
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  const payload = await verifyToken(token, secret)
  assert.ok(payload)
  assert.equal(payload.uid, 42)
  assert.equal(payload.email, 'admin@example.com')
  assert.equal(typeof payload.exp, 'number')
})

test('verifyToken rejects wrong secret and tampered payload', async () => {
  const secret = 'test-secret-key-at-least-32-chars!!'
  const token = await signToken({ uid: 1 }, secret, 3600)
  assert.equal(await verifyToken(token, 'other-secret-key-at-least-32-chars!'), null)
  const [json] = token.split('.')
  assert.equal(await verifyToken(json + '.invalidsignaturevalue', secret), null)
  assert.equal(await verifyToken(undefined, secret), null)
  assert.equal(await verifyToken('', secret), null)
})

test('verifyToken rejects expired tokens', async () => {
  const secret = 'test-secret-key-at-least-32-chars!!'
  const token = await signToken({ uid: 7 }, secret, -10)
  assert.equal(await verifyToken(token, secret), null)
})
