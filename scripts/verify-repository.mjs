#!/usr/bin/env node
/** Repository integrity check before Cloudflare deployment. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const requiredFiles = [
  'package.json',
  'package-lock.json',
  'wrangler.toml',
  '.nvmrc',
  '.gitignore',
  'src/index.ts',
  'scripts/deploy-all.mjs',
  'scripts/setup-cloudflare.mjs',
  'scripts/check-schema.mjs',
  'scripts/postdeploy-check.mjs',
  'src/utils/protectedSecrets.ts',
  'migrations/0001_baseline.sql',
  'migrations/0002_seed.sql',
  'VERSION',
  'CHANGELOG.md',
]
const requiredDirs = ['src', 'public', 'migrations', 'scripts', '.github/workflows']

let failed = false
function check(label, ok) { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) failed = true }

for (const file of requiredFiles) check(`file ${file}`, existsSync(join(root, file)))
for (const dir of requiredDirs) check(`directory ${dir}`, existsSync(join(root, dir)))

// 废弃文件：两阶段部署留下的第二个配置文件与旧入口脚本
for (const obsolete of ['wrangler.production.toml', 'scripts/deploy.mjs']) {
  check(`obsolete ${obsolete} absent`, !existsSync(join(root, obsolete)))
}

try {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const requiredScripts = [
    'deploy', 'setup:cloudflare', 'doctor', 'verify', 'typecheck', 'build',
    'check:routes', 'check:public', 'check:seo-geo', 'check:deployment',
    'check:migrations', 'check:schema', 'check:whitelabel', 'check:contact-fields', 'check:ai-qa', 'check:admin-templates', 'test',
  ]
  for (const script of requiredScripts) check(`npm script ${script}`, Boolean(pkg.scripts?.[script]))
  const versionFile = readFileSync(join(root, 'VERSION'), 'utf8').trim()
  check('package version matches VERSION', pkg.version === versionFile)
} catch { check('package.json readable', false) }

try {
  const wrangler = readFileSync(join(root, 'wrangler.toml'), 'utf8')
  check('D1 binding configured', /binding\s*=\s*["']DB["']/.test(wrangler))
  check('D1 database_name configured', /database_name\s*=\s*["']white-label-cms-db["']/.test(wrangler))
  check('D1 migrations configured', /migrations_dir\s*=\s*["']migrations["']/.test(wrangler))
  check('KV binding configured', /\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*["']CACHE_KV["']/.test(wrangler))
  check('R2 bucket_name configured', /bucket_name\s*=\s*["']white-label-cms-r2-media["']/.test(wrangler))
  check('ASSETS binding configured', /binding\s*=\s*["']ASSETS["']/.test(wrangler))
  // 模板必须保持干净：账号专属 ID 只存在于 gitignore 的 .wrangler.deploy.toml
  check('no hardcoded D1 database_id in template', !/^\s*database_id\s*=\s*["'][^"']+["']/m.test(wrangler))
  check('no hardcoded KV id in template', !(/\[\[kv_namespaces\]\][\s\S]*?^id\s*=\s*["'][^"']+["']/m.test(wrangler)))
} catch { check('wrangler.toml readable', false) }

try {
  const gitignore = readFileSync(join(root, '.gitignore'), 'utf8')
  // lockfile 必须入库：npm ci 依赖它
  check('package-lock.json is tracked (not ignored)', !/^package-lock\.json\s*$/m.test(gitignore))
  check('.dev.vars ignored', /^\.dev\.vars\s*$/m.test(gitignore))
  check('.wrangler.deploy.toml ignored', /^\.wrangler\.deploy\.toml\s*$/m.test(gitignore))
} catch { check('.gitignore readable', false) }

if (failed) { console.error('\nRepository validation failed.'); process.exit(1) }
console.log('\nRepository validation passed.')
