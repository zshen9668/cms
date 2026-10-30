import { test } from 'node:test'
import assert from 'node:assert/strict'
import { articleCategoryMenu } from '../src/utils/navCategories.ts'

test('empty and blank categories produce no menu entries', () => {
  assert.deepEqual(articleCategoryMenu([{ category: '' }, { category: null }, {}]), [])
})

test('categories are counted, sorted by frequency and encoded into paths', () => {
  const menu = articleCategoryMenu([{ category: '政策解读' }, { category: '业务指南' }, { category: '政策解读' }])
  assert.deepEqual(menu.map((m) => [m.name, m.count]), [['政策解读', 2], ['业务指南', 1]])
  assert.equal(menu[0].path, '/article/category/' + encodeURIComponent('政策解读'))
})

test('menu is capped at the configured maximum', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ category: 'c' + i }))
  assert.equal(articleCategoryMenu(rows).length, 8)
})
