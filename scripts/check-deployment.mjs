// 部署配置校验：确保配置文件、package.json 脚本、README 与忽略规则互相一致。
//
// 这一层校验专门盯住几类"改了一处忘了另一处"的问题，以及曾经导致部署失败的几个坑：
//   - package-lock.json 被 gitignore，而 CI 用 npm ci（必须提交 lockfile）
//   - wrangler.toml 里混入账号专属的 D1/KV ID（模板必须保持干净）
//   - 又冒出第二个 wrangler 配置文件，回到"两阶段部署"的割裂状态
import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const wrangler = fs.readFileSync('wrangler.toml', 'utf8')
const nvmrc = fs.existsSync('.nvmrc') ? fs.readFileSync('.nvmrc', 'utf8').trim() : ''
const gitignore = fs.readFileSync('.gitignore', 'utf8')

const problems = []
const require_ = (condition, message) => { if (!condition) problems.push(message) }

// --- package.json 脚本 ----------------------------------------------------

const expectedScripts = {
  // dev 必须带 --local：不带时 Wrangler 会把 env.AI 当成 remote 绑定，
  // 启动时强制建立远程代理会话，于是要求 Cloudflare 登录授权（无浏览器时会超时失败），
  // 新用户跑 npm run dev 直接起不来。加 --local 后 AI 在本地标记为 not supported，
  // 站点其余部分完全正常运行。
  dev: 'wrangler dev --local',
  build: 'npm run typecheck',
  predeploy: 'node scripts/predeploy.mjs',
  deploy: 'node scripts/deploy-all.mjs',
  'setup:cloudflare': 'node scripts/setup-cloudflare.mjs',
  'check:schema': 'node scripts/check-schema.mjs',
  'check:routes': 'node scripts/check-admin-routes.mjs',
  'check:public': 'node scripts/check-public-routes.mjs',
  'check:seo-geo': 'node scripts/check-seo-geo.mjs',
  'check:migrations': 'node scripts/check-migrations.mjs',
  'check:deployment': 'node scripts/check-deployment.mjs',
  'check:whitelabel': 'node scripts/check-white-label.mjs',
  'check:contact-fields': 'node scripts/check-contact-fields.mjs',
}
for (const [key, value] of Object.entries(expectedScripts)) {
  require_(pkg.scripts?.[key] === value, `package.json scripts.${key} 必须是 "${value}"`)
}

// --- Node 版本一致性 ------------------------------------------------------

require_(pkg.engines?.node === '>=26.0.0', 'package.json engines.node 必须是 ">=26.0.0"')
require_(nvmrc === '26.10.0', '.nvmrc 必须是 26.10.0（CI 用 node-version-file 读取它）')

// --- wrangler.toml 必需项 -------------------------------------------------

const requiredConfig = [
  ['name', /^name\s*=\s*"white-label-cms"\s*$/m],
  ['main', /^main\s*=\s*"src\/index\.ts"\s*$/m],
  ['构建命令', /\[build\][\s\S]*?command\s*=\s*"npm run build"/],
  ['静态资源绑定', /directory\s*=\s*"\.\/public"[\s\S]*?binding\s*=\s*"ASSETS"/],
  ['D1 绑定', /\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"DB"[\s\S]*?database_name\s*=\s*"white-label-cms-db"[\s\S]*?migrations_dir\s*=\s*"migrations"/],
  ['KV 绑定', /\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"CACHE_KV"/],
  ['R2 绑定', /\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*"R2_MEDIA"[\s\S]*?bucket_name\s*=\s*"white-label-cms-r2-media"/],
  ['Workers AI 绑定', /\[ai\][\s\S]*?binding\s*=\s*"AI"/],
]
for (const [label, re] of requiredConfig) {
  require_(re.test(wrangler), `wrangler.toml 缺少${label}`)
}

const cronMatch = wrangler.match(/\[triggers\][\s\S]*?crons\s*=\s*\[\s*"([^"]+)"/)
require_(Boolean(cronMatch) && cronMatch[1].trim().split(/\s+/).length === 5, 'Cloudflare Cron 必须是 5 段表达式')

// --- compatibility_date 不得是未来日期 ------------------------------------
// 旧配置写的 "2026-10-17" 比 Wrangler 内置 workerd 支持的最新日期还新，
// 导致 `wrangler dev` 直接报 "required compatibility date ... newest date supported" 而无法启动。
const compatMatch = wrangler.match(/^compatibility_date\s*=\s*"(\d{4}-\d{2}-\d{2})"/m)
require_(Boolean(compatMatch), 'wrangler.toml 缺少 compatibility_date')
if (compatMatch) {
  const declared = compatMatch[1]
  const today = new Date().toISOString().slice(0, 10)
  require_(
    declared <= today,
    `wrangler.toml 的 compatibility_date (${declared}) 是未来日期，会超出当前 Wrangler 内置 workerd 支持范围并导致 wrangler dev 启动失败`
  )
}

// --- 模板必须保持干净 -----------------------------------------------------

require_(
  !/^\s*database_id\s*=\s*["'][^"']+["']/m.test(wrangler),
  'wrangler.toml 不得包含真实 D1 database_id（由 npm run deploy 写入 .wrangler.deploy.toml）'
)
require_(
  !/\[\[kv_namespaces\]\][\s\S]*?^id\s*=\s*["'][^"']+["']/m.test(wrangler),
  'wrangler.toml 不得包含真实 KV namespace id（由 npm run deploy 写入 .wrangler.deploy.toml）'
)

// --- 不得回退到"两阶段部署" ----------------------------------------------

require_(!fs.existsSync('wrangler.production.toml'), 'wrangler.production.toml 已废弃，请删除；现在只有 wrangler.toml 一份配置')
if (fs.existsSync('wrangler.production.toml')) {
  console.log('  · 提示：两阶段部署（wrangler.toml + wrangler.production.toml）已被单一配置取代。')
}

// --- .gitignore 规则 ------------------------------------------------------

require_(
  !/^package-lock\.json\s*$/m.test(gitignore),
  '.gitignore 不得忽略 package-lock.json —— CI 与 Workers Builds 使用 npm ci，需要仓库中存在 lockfile'
)
require_(
  /^\.wrangler\.deploy\.toml\s*$/m.test(gitignore),
  '.gitignore 必须忽略 .wrangler.deploy.toml（部署脚本生成，含账号专属资源 ID）'
)
require_(/^\.dev\.vars\s*$/m.test(gitignore), '.gitignore 必须忽略 .dev.vars（本地密钥）')
require_(fs.existsSync('package-lock.json'), 'package-lock.json 必须存在并提交到仓库')

// --- 静态资源版本一致性 ----------------------------------------------------
// public/styles.css 由 Workers Assets 发布并带长缓存。改完样式忘了升 ?v=，
// 站长看到的是旧样式（刷新也无效，因为文件本身没变），表现成"改了没生效"。
// 版本号因此集中在 src/templates/assets.ts，源码里不允许再硬编码该地址。

const assetVersionSource = 'src/templates/assets.ts'
require_(fs.existsSync(assetVersionSource), `${assetVersionSource} 缺失 —— 样式表版本号的单一真相源`)
const assetConsumers = ['src/templates/layout.ts', 'src/templates/adminLayout.ts', 'src/routes/admin/auth.ts', 'src/routes/admin/news.ts']
const hardcodedStylesheet = assetConsumers.filter((file) => {
  if (!fs.existsSync(file)) return false
  return /href="\/styles\.css/.test(fs.readFileSync(file, 'utf8'))
})
require_(
  hardcodedStylesheet.length === 0,
  `以下文件硬编码了 /styles.css 地址，应改用 ${assetVersionSource} 导出的 STYLESHEET_HREF：${hardcodedStylesheet.join(', ')}`
)
if (fs.existsSync(assetVersionSource)) {
  const assetVersion = /STYLESHEET_VERSION\s*=\s*'([^']+)'/.exec(fs.readFileSync(assetVersionSource, 'utf8'))
  require_(Boolean(assetVersion), `${assetVersionSource} 缺少 STYLESHEET_VERSION 声明`)
}

// --- 必需文件 -------------------------------------------------------------

for (const file of ['scripts/predeploy.mjs', 'scripts/deploy-all.mjs', 'scripts/setup-cloudflare.mjs', 'scripts/postdeploy-check.mjs', 'scripts/check-schema.mjs']) {
  require_(fs.existsSync(file), `${file} 缺失`)
}
require_(!fs.existsSync('scripts/deploy.mjs'), '过期的 scripts/deploy.mjs 不应存在')

// --- README 部署说明 ------------------------------------------------------

const readme = fs.readFileSync('README.md', 'utf8')
const readmeMarkers = [
  'npm run deploy',
  '.dev.vars',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'SETUP_TOKEN',
  '/admin/setup',
]
for (const marker of readmeMarkers) {
  require_(readme.includes(marker), `README 部署说明缺少关键标记: ${marker}`)
}
require_(
  !readme.includes('wrangler.production.toml'),
  'README 仍在引用已废弃的 wrangler.production.toml，请改为单一 wrangler.toml 的说明'
)

// --- 结果 -----------------------------------------------------------------

if (problems.length > 0) {
  console.error('部署配置检查失败：')
  for (const p of problems) console.error(' - ' + p)
  process.exit(1)
}
console.log('Cloudflare 部署配置 OK：单一 wrangler.toml、lockfile 已入库、模板不含资源 ID、README 与脚本一致')
