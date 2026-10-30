#!/usr/bin/env node
/**
 * 白标 CMS 一键部署（唯一入口：npm run deploy）
 *
 * 依次完成：
 *   1. 环境自检（Node 版本、必需文件、本地 wrangler）
 *   2. 读取凭证（环境变量优先，其次项目根目录的 .dev.vars）
 *   3. 有凭证时幂等创建/复用 D1、KV、R2，并把 ID 写回 wrangler.toml
 *   4. 应用 migrations/ 下全部 D1 迁移（数据库先于 Worker 就绪）
 *   5. 发布 Worker
 *   6. 访问 /healthz?probe=1 做部署后自检
 *
 * 凭证是可选的：不提供时脚本直接进入第 4 步，由 Wrangler 按 wrangler.toml 里的
 * 资源名解析绑定。此时资源必须已经在 Cloudflare 账号中存在，否则会明确报错，
 * 不会伪报成功。
 *
 * 设计原则：
 *   - 幂等：已存在的资源复用，重复执行安全。
 *   - 数据库优先：迁移在 Worker 发布之前应用，避免新代码跑在旧 schema 上。
 *   - 单一配置：只用 wrangler.toml，不再有"第二阶段改 Deploy command"这种操作。
 *   - 无硬编码账号 ID：资源名从 wrangler.toml 读取。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const CONFIG = 'wrangler.toml'
const GENERATED_CONFIG = '.wrangler.deploy.toml'
const HEALTH_CHECK_TIMEOUT_MS = Number(process.env.DEPLOY_HEALTH_TIMEOUT_MS || 15000)

const localWrangler = process.platform === 'win32'
  ? join(root, 'node_modules', '.bin', 'wrangler.cmd')
  : join(root, 'node_modules', '.bin', 'wrangler')

const useLocalWrangler = existsSync(localWrangler)
const wrangler = useLocalWrangler ? localWrangler : 'npx'

function run(args, options = {}) {
  const capture = options.capture || false
  const commandArgs = useLocalWrangler ? args : ['wrangler', ...args]
  const result = spawnSync(wrangler, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  return result
}

function fail(label, result) {
  console.error(`✖ ${label} 失败`)
  if (result?.stdout) console.error(String(result.stdout).slice(-3000))
  if (result?.stderr) console.error(String(result.stderr).slice(-3000))
  process.exit(result?.status || 1)
}

/** 读取 .dev.vars（已 gitignore），让本地用户不必手动 export 环境变量。 */
function loadDevVars() {
  const path = join(root, '.dev.vars')
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    // 已存在的环境变量优先，不覆盖 CI 注入的 Secret
    if (!process.env[key]) process.env[key] = value
  }
}

function getCredentials() {
  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || ''
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || ''
  return token && accountId ? { token, accountId } : null
}

function checkEnvironment() {
  if (!existsSync(join(root, 'package.json'))) {
    console.error('✖ 缺少 package.json，请在本项目根目录执行 npm run deploy')
    process.exit(1)
  }
  if (!existsSync(join(root, CONFIG))) {
    console.error(`✖ 缺少 ${CONFIG}`)
    process.exit(1)
  }
  if (!existsSync(join(root, 'migrations'))) {
    console.error('✖ 缺少 migrations 目录')
    process.exit(1)
  }
  if (!useLocalWrangler) {
    console.error('✖ 未找到本地 wrangler，请先执行: npm install')
    process.exit(1)
  }
  const version = run(['--version'], { capture: true })
  if (version.status !== 0) {
    console.error('✖ wrangler 不可用。请先执行: npm install')
    process.exit(1)
  }
  const major = Number(process.versions.node.split('.')[0])
  if (Number.isFinite(major) && major < 22) {
    console.error(`✖ 需要 Node 22 及以上（当前 ${process.versions.node}）。请使用 .nvmrc 指定的版本。`)
    process.exit(1)
  }
  console.log('✔ 环境自检通过')
}

function provisionResources() {
  console.log('→ 创建/复用 Cloudflare D1、KV、R2 资源')
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'setup-cloudflare.mjs')], {
    cwd: root, encoding: 'utf8', stdio: 'inherit', env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    console.error('✖ Cloudflare 资源准备失败')
    process.exit(result.status || 1)
  }
}

/**
 * 使用哪份配置部署：
 *   - 有凭证时 setup-cloudflare.mjs 会生成 .wrangler.deploy.toml，其中注入了 D1 database_id 与 KV id；
 *   - 没有凭证时直接用 wrangler.toml，由 Wrangler 按资源名解析绑定。
 * 生成文件已 gitignore，保证 wrangler.toml 永远不含账号专属 ID。
 */
function activeConfig() {
  return existsSync(join(root, GENERATED_CONFIG)) ? GENERATED_CONFIG : CONFIG
}

function readD1Binding() {
  const text = readFileSync(join(root, activeConfig()), 'utf8')
  const match = text.match(/\[\[d1_databases\]\][\s\S]*?^binding\s*=\s*["']([^"']+)["']/m)
  return match?.[1] || 'DB'
}

function applyD1Migrations() {
  const binding = readD1Binding()
  const config = activeConfig()
  console.log(`→ 应用 D1 迁移（binding: ${binding}）`)
  const result = run(['d1', 'migrations', 'apply', binding, '--remote', '--config', config], { capture: true })
  const out = `${result.stdout || ''}${result.stderr || ''}`
  if (result.status !== 0) {
    if (/already (applied|exist)|No migrations to apply/i.test(out)) {
      console.log('ℹ 迁移已是最新，跳过。')
      return
    }
    console.error('')
    console.error('D1 迁移失败。若资源尚未创建，请先在项目根目录创建 .dev.vars 并填入：')
    console.error('  CLOUDFLARE_API_TOKEN=你的Token')
    console.error('  CLOUDFLARE_ACCOUNT_ID=你的AccountID')
    console.error('然后重新执行 npm run deploy（会自动创建 D1/KV/R2）。')
    console.error('也可以手动只补数据库结构：')
    console.error(`  npx wrangler d1 migrations apply ${binding} --remote --config ${config}`)
    console.error('')
    fail('D1 migrations apply', result)
  }
  process.stdout.write(out)
  console.log('✔ D1 迁移应用完成')
}

function deployWorker() {
  console.log('→ 发布 Worker 到 Cloudflare Workers')
  const result = run(['deploy', '--config', activeConfig()], { capture: true })
  const out = `${result.stdout || ''}\n${result.stderr || ''}`
  if (result.status !== 0) {
    console.error(out.slice(-3000))
    console.error('')
    console.error('Worker 发布失败。常见原因：')
    console.error('  · wrangler.toml 里的 D1/KV ID 为空，且账号中还没有对应资源')
    console.error('    → 在项目根目录创建 .dev.vars 填入 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID 后重跑 npm run deploy')
    console.error('  · R2 bucket 不存在 → 在 Cloudflare 控制台 R2 页面创建 white-label-cms-r2-media')
    console.error('  · 账号未开通 Workers AI → 删除 wrangler.toml 中的 [ai] 段落即可（AI 功能会降级关闭）')
    console.error('')
    fail('Worker deploy', result)
  }
  process.stdout.write(out)
  return out
}

function extractWorkersUrl(output) {
  const matches = output.match(/https:\/\/[^\s"'<>]+\.workers\.dev(?:\/[^\s"'<>]*)?/g) || []
  return matches.at(-1) || ''
}

async function fetchWithTimeout(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS)
  try {
    return await fetch(url, { redirect: 'follow', signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function runHealthCheck(deployOutput) {
  const url = process.env.DEPLOY_SMOKE_URL || extractWorkersUrl(deployOutput)
  if (!url) {
    console.log('ℹ 未检测到 workers.dev URL，跳过部署后自检。')
    console.log('  如需自检，设置 DEPLOY_SMOKE_URL=https://你的项目.workers.dev 后重跑。')
    return
  }

  const base = url.replace(/\/$/, '')
  console.log(`→ 部署后自检: ${base}/healthz?probe=1`)

  let lastError = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchWithTimeout(`${base}/healthz?probe=1`)
      const body = await response.text()
      if (!response.ok) {
        lastError = `healthz 返回 HTTP ${response.status}`
      } else {
        let data
        try {
          data = JSON.parse(body)
        } catch {
          lastError = 'healthz 返回不是合法 JSON'
          data = null
        }
        if (data) {
          const bindings = data.bindings || {}
          const required = ['DB', 'CACHE_KV', 'ASSETS']
          const missing = required.filter((name) => bindings[name] !== true)
          if (data.ok && data.d1_schema === true && missing.length === 0) {
            console.log(JSON.stringify({
              ok: data.ok,
              bindings: data.bindings,
              d1_schema: data.d1_schema,
            }, null, 2))
            if (bindings.R2_MEDIA !== true) {
              console.log('ℹ R2_MEDIA 未绑定：媒体上传/访问不可用（/media/* 返回 503），其余功能正常。')
            }
            if (bindings.AI !== true) {
              console.log('ℹ AI 未绑定：AI 内容生成不可用，其余功能正常。')
            }
            console.log('✔ 部署后自检通过')
            return
          }
          lastError = data.d1_schema !== true
            ? `D1 schema 未就绪（缺少表：${(data.missing_tables || []).join(', ') || '未知'}）`
            : `缺少绑定：${missing.join(', ') || '无'}`
        }
      }
    } catch (e) {
      lastError = String(e?.message || e)
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 3000))
  }

  console.error(`✖ 部署后自检未通过：${lastError}`)
  console.error('Worker 已经发布，但健康检查没通过。请打开上面的 URL 查看 /healthz 返回的 bindings 与 missing_tables。')
  process.exit(1)
}

async function main() {
  checkEnvironment()
  loadDevVars()

  const credentials = getCredentials()
  if (credentials) {
    console.log('→ 检测到 Cloudflare 凭证，将自动创建/复用资源并写入 ID')
    provisionResources()
  } else {
    console.log('ℹ 未检测到 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID。')
    console.log('  将直接使用 wrangler.toml 中已有的资源名与 ID 部署。')
    console.log('  如果这是首次部署，请先创建 .dev.vars 填入上面两个值，脚本会自动建好 D1/KV/R2。')
  }

  applyD1Migrations()
  const deployOutput = deployWorker()
  await runHealthCheck(deployOutput)
  console.log('✔ 部署完成')
}

try {
  await main()
} catch (error) {
  console.error('deploy 失败:', error?.message || error)
  process.exit(1)
}
