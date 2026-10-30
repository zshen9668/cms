import test from 'node:test'
import assert from 'node:assert/strict'
import { analyticsPlugin } from '../src/plugins/analytics/index.ts'

test('analyticsPlugin exposes stable contract', () => {
  assert.equal(analyticsPlugin.id, 'analytics')
  assert.equal(analyticsPlugin.version, '1.0.0')
  assert.equal(typeof analyticsPlugin.mount, 'function')
  // 无 onScheduled:纯请求驱动
  assert.equal(analyticsPlugin.onScheduled, undefined)
})

test('analyticsPlugin.mount registers without env (routes read c.env lazily)', () => {
  let mounted = false
  const fakeApp = {
    route: (_prefix: string, _sub: unknown) => { mounted = true; return fakeApp },
  } as any
  analyticsPlugin.mount(fakeApp)
  assert.equal(mounted, true)
})
