import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHomeSectionOrder } from '../src/utils/homeSectionConfig.ts'

test('empty or missing config yields the default order, all visible', () => {
  const slots = parseHomeSectionOrder('')
  assert.deepEqual(slots.map((s) => s.key), ['intro', 'services', 'cases', 'articles', 'contact'])
  assert.ok(slots.every((s) => s.visible))
})

test('dash prefix hides a section but keeps its position', () => {
  const slots = parseHomeSectionOrder('contact,-cases,intro')
  assert.deepEqual(slots.map((s) => [s.key, s.visible]), [
    ['contact', true], ['cases', false], ['intro', true], ['services', true], ['articles', true],
  ])
})

test('unknown and duplicate keys are dropped, missing keys appended', () => {
  const slots = parseHomeSectionOrder('bogus,services,services,-intro')
  assert.deepEqual(slots.map((s) => s.key), ['services', 'intro', 'cases', 'articles', 'contact'])
  assert.equal(slots.find((s) => s.key === 'intro')?.visible, false)
})

test('首页模块不再包含 cities，改为 cases', () => {
  const keys = parseHomeSectionOrder('').map((s) => s.key)
  assert.equal(keys.includes('cities' as never), false)
  assert.equal(keys.includes('cases' as never), true)
})
