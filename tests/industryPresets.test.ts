import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INDUSTRY_PRESETS, getIndustryPreset, presetToSettings } from '../src/utils/industryPresets.ts'

const LIMITS: Record<string, number> = {
  site_topic: 120, site_industry: 80, site_description: 1000,
  primary_services: 1000, primary_keywords: 1200, industry_keywords: 1600, news_categories: 500,
}

test('every preset fits the profile save limits and has all fields', () => {
  for (const preset of INDUSTRY_PRESETS) {
    const settings = presetToSettings(preset)
    for (const [key, max] of Object.entries(LIMITS)) {
      assert.ok(settings[key], `${preset.id}.${key} is empty`)
      assert.ok(settings[key].length <= max, `${preset.id}.${key} exceeds ${max}`)
    }
  }
})

test('preset ids are unique and lookup works', () => {
  const ids = INDUSTRY_PRESETS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(getIndustryPreset('nope'), null)
  assert.equal(getIndustryPreset(ids[0])?.id, ids[0])
})
