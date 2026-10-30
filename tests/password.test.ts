import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
  hashPassword,
  verifyPassword,
  DEFAULT_PBKDF2_ITERATIONS,
  DUMMY_PASSWORD_HASH,
  getPbkdf2Iterations,
  validatePasswordStrength,
} from '../src/utils/password.ts'

test('hashPassword uses PBKDF2 and verifies', async () => {
  const hash = await hashPassword('secret-password-123')
  assert.match(hash, /^pbkdf2\$\d+\$/)
  const ok = await verifyPassword('secret-password-123', hash)
  assert.equal(ok.valid, true)
  assert.equal(ok.needsUpgrade, false)
  const bad = await verifyPassword('wrong', hash)
  assert.equal(bad.valid, false)
})

test('getPbkdf2Iterations falls back and clamps to [default, max]', () => {
  assert.equal(getPbkdf2Iterations(undefined), DEFAULT_PBKDF2_ITERATIONS)
  assert.equal(getPbkdf2Iterations({ PBKDF2_ITERATIONS: 'abc' }), DEFAULT_PBKDF2_ITERATIONS)
  assert.equal(getPbkdf2Iterations({ PBKDF2_ITERATIONS: '-5' }), DEFAULT_PBKDF2_ITERATIONS)
  assert.equal(getPbkdf2Iterations({ PBKDF2_ITERATIONS: '100' }), DEFAULT_PBKDF2_ITERATIONS)
  assert.equal(getPbkdf2Iterations({ PBKDF2_ITERATIONS: '50000' }), DEFAULT_PBKDF2_ITERATIONS)
  assert.equal(getPbkdf2Iterations({ PBKDF2_ITERATIONS: '9999999' }), 600000)
})

test('hash created with a higher iteration count verifies and old hashes are flagged for upgrade', async () => {
  const low = await hashPassword('Another-secret-1', 5000)
  const high = await hashPassword('Another-secret-1', 10000)
  assert.match(high, /^pbkdf2\$10000\$/)
  assert.equal((await verifyPassword('Another-secret-1', high, 10000)).needsUpgrade, false)
  assert.equal((await verifyPassword('Another-secret-1', low, 10000)).needsUpgrade, true)
  assert.equal((await verifyPassword('Another-secret-1', low, 10000)).valid, true)
})

test('hash produced by scripts/create-admin.mjs (node crypto) verifies in the Worker implementation', async () => {
  const salt = crypto.randomBytes(16)
  const derived = crypto.pbkdf2Sync('Str0ng-Pass-Word', salt, 5000, 32, 'sha256')
  const stored = `pbkdf2$5000$${salt.toString('base64url')}$${derived.toString('base64url')}`
  assert.equal((await verifyPassword('Str0ng-Pass-Word', stored)).valid, true)
  assert.equal((await verifyPassword('Str0ng-Pass-Wrong', stored)).valid, false)
})

test('dummy hash is a well-formed PBKDF2 hash that never verifies', async () => {
  const parts = DUMMY_PASSWORD_HASH.split('$')
  assert.equal(parts.length, 4)
  assert.equal(Buffer.from(parts[2], 'base64url').length, 16)
  assert.equal(Buffer.from(parts[3], 'base64url').length, 32)
  assert.equal((await verifyPassword('anything-at-all-1', DUMMY_PASSWORD_HASH)).valid, false)
})

test('validatePasswordStrength enforces length, variety and non-obvious values', () => {
  assert.equal(validatePasswordStrength('short1A'), '密码至少 10 位')
  assert.equal(validatePasswordStrength('a'.repeat(129)), '密码不能超过 128 位')
  assert.equal(validatePasswordStrength('aaaaaaaaaaaa'), '密码不能是同一个字符重复')
  assert.equal(validatePasswordStrength('alllowercaseonly'), '密码需至少包含两类字符（大写、小写、数字、符号）')
  assert.equal(validatePasswordStrength('admin@example.com', 'Admin@Example.com'), '密码不能与登录邮箱相同')
  assert.equal(validatePasswordStrength('ExampleUser', 'exampleuser@mail.test'), '密码不能与登录邮箱相同')
  assert.equal(validatePasswordStrength('Str0ng-Pass-Word', 'admin@example.com'), null)
  assert.equal(validatePasswordStrength('lowercase1234'), null)
})
