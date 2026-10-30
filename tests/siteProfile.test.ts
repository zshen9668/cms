import test from 'node:test'
import assert from 'node:assert/strict'
import { getGlobalSeoKeywords, getSiteProfile } from '../src/utils/siteProfile.ts'

test('builds one deduplicated keyword pool from primary, industry, and site keywords', () => {
  const profile = getSiteProfile({
    site_name: 'Demo',
    site_topic: 'Example topic',
    primary_keywords: 'alpha,beta',
    industry_keywords: 'beta,gamma',
    site_keywords: 'gamma,delta',
  })
  assert.deepEqual(getGlobalSeoKeywords(profile, 20), ['alpha', 'beta', 'gamma', 'delta'])
})

test('keeps industry keywords bounded and deduplicated', () => {
  const profile = getSiteProfile({
    industry_keywords: 'alpha,beta,alpha,gamma',
  })
  assert.deepEqual(profile.industryKeywords, ['alpha', 'beta', 'gamma'])
})
