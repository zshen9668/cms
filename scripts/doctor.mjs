#!/usr/bin/env node
/**
 * Deployment readiness report for fresh Cloudflare environments.
 */
import { existsSync, readFileSync } from 'node:fs'

const checks = []
const ok = (name, result, detail = '') => checks.push({ name, result, detail })

const REQUIRED_NODE = '26'
ok('Node version', process.versions.node.startsWith(REQUIRED_NODE + '.'), `${process.versions.node} (required ${REQUIRED_NODE}.x)`)
ok('package.json', existsSync('package.json'))
ok('wrangler.toml', existsSync('wrangler.toml'))
ok('deploy script', existsSync('scripts/deploy-all.mjs'))
ok('migration directory', existsSync('migrations'))
ok('source directory', existsSync('src'))

try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  ok('npm deploy command', Boolean(pkg.scripts?.deploy), pkg.scripts?.deploy || '')
  ok('npm verify command', Boolean(pkg.scripts?.verify), pkg.scripts?.verify || '')
} catch (error) {
  ok('package.json parse', false, error.message)
}

let failed = false
console.log('\nCloudflare deployment readiness\n')
for (const check of checks) {
  const mark = check.result ? '✓' : '✗'
  console.log(`${mark} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
  if (!check.result) failed = true
}

if (failed) process.exit(1)
console.log('\nReady for npm run deploy')
