#!/usr/bin/env node
/**
 * 幂等创建 Cloudflare D1 / KV / R2 资源，并生成部署用配置 .wrangler.deploy.toml。
 *
 * 由 `npm run deploy` 自动调用，也可以单独运行：npm run setup:cloudflare
 *
 * 凭证（通过 .dev.vars 或环境变量注入，禁止写入源码或提交到仓库）：
 *   CLOUDFLARE_API_TOKEN  —— 权限需含 D1 Write、Workers KV Storage Edit、Workers R2 Storage Edit
 *   CLOUDFLARE_ACCOUNT_ID —— Cloudflare 账户主页右侧的 Account ID
 *
 * 为什么不直接把 ID 写回 wrangler.toml：
 *   wrangler.toml 是受版本控制的模板，必须保持不含任何账号专属 ID，
 *   否则别人 clone 你的仓库会把 Worker 绑到你的数据库上。
 *   所以这里把 ID 注入到 .wrangler.deploy.toml（已 gitignore），部署时用
 *   `wrangler deploy --config .wrangler.deploy.toml`。
 *
 * 其它要点：
 *   - 资源名从 wrangler.toml 读取，不再硬编码，避免"脚本建的资源名和配置对不上"。
 *   - 所有请求带超时，避免在 CI 里无响应挂起。
 *   - 已存在则复用，重复执行安全。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const sourcePath = join(root, 'wrangler.toml')
const outputPath = join(root, '.wrangler.deploy.toml')
const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID
const API_TIMEOUT_MS = Number(process.env.CF_API_TIMEOUT_MS || 20000)

function log(message) { console.log(`[setup-cloudflare] ${message}`) }

if (!token || !accountId) {
  console.error('资源自动创建需要 CLOUDFLARE_API_TOKEN 和 CLOUDFLARE_ACCOUNT_ID（兼容旧变量 CF_API_TOKEN / CF_ACCOUNT_ID）。')
  console.error('请在项目根目录创建 .dev.vars（本地）或配置 GitHub Secrets（CI）后重试。严禁把 Token 写入源码或提交到仓库。')
  process.exit(1)
}

async function api(path, options = {}) {
  let response
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...options,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new Error(`Cloudflare API ${options.method || 'GET'} ${path} 超时（${API_TIMEOUT_MS}ms）。请检查网络或代理设置。`)
    }
    throw e
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.success === false) {
    const errors = (body.errors || []).map((e) => `${e.code || ''} ${e.message || ''}`).join('; ')
    throw new Error(`Cloudflare API ${options.method || 'GET'} ${path} 失败 (${response.status}): ${errors || response.statusText}`)
  }
  return body.result
}

// --- 从 wrangler.toml 读取资源名，避免脚本与配置漂移 -----------------------

function readSourceToml() {
  try {
    return readFileSync(sourcePath, 'utf8')
  } catch {
    console.error(`✖ 找不到 ${sourcePath}`)
    process.exit(1)
  }
}

function sectionBlock(text, section) {
  const start = text.indexOf(section)
  if (start < 0) return ''
  const next = text.indexOf('\n[[', start + section.length)
  return text.slice(start, next < 0 ? text.length : next)
}

function readName(text, section, key, fallback) {
  const block = sectionBlock(text, section)
  const m = block.match(new RegExp(`^${key}\\s*=\\s*["']([^"']+)["']`, 'm'))
  return m?.[1] || fallback
}

const sourceToml = readSourceToml()
const d1Name = readName(sourceToml, '[[d1_databases]]', 'database_name', 'white-label-cms-db')
const r2Name = readName(sourceToml, '[[r2_buckets]]', 'bucket_name', 'white-label-cms-r2-media')
const kvTitle = readName(sourceToml, '[[kv_namespaces]]', 'binding', 'CACHE_KV')

log(`目标资源：D1=${d1Name}、KV=${kvTitle}、R2=${r2Name}`)

// --- 幂等创建 -------------------------------------------------------------

async function ensureD1(name) {
  const found = await api(`/accounts/${accountId}/d1/database?name=${encodeURIComponent(name)}`)
  const item = Array.isArray(found) ? found.find((x) => x.name === name) : null
  if (item?.uuid) { log(`D1 ${name} 已存在，复用`); return item.uuid }
  const created = await api(`/accounts/${accountId}/d1/database`, { method: 'POST', body: JSON.stringify({ name }) })
  if (!created?.uuid) throw new Error(`D1 ${name} 创建成功但响应缺少 uuid`)
  log(`D1 ${name} 已创建`)
  return created.uuid
}

async function ensureKV(title) {
  // 分页遍历，避免账号下 namespace 较多时漏查而重复创建
  let page = 1
  for (;;) {
    const result = await api(`/accounts/${accountId}/storage/kv/namespaces?per_page=100&page=${page}`)
    const list = Array.isArray(result) ? result : (result?.result || result?.namespaces || [])
    const item = list.find((x) => x.title === title)
    if (item?.id) { log(`KV ${title} 已存在，复用`); return item.id }
    if (!Array.isArray(result) || list.length < 100) break
    page += 1
  }
  const created = await api(`/accounts/${accountId}/storage/kv/namespaces`, { method: 'POST', body: JSON.stringify({ title }) })
  if (!created?.id) throw new Error(`KV ${title} 创建成功但响应缺少 id`)
  log(`KV ${title} 已创建`)
  return created.id
}

async function ensureR2(name) {
  const found = await api(`/accounts/${accountId}/r2/buckets`)
  const list = Array.isArray(found) ? found : (found?.buckets || found?.result?.buckets || [])
  if (list.some((x) => x.name === name)) { log(`R2 ${name} 已存在，复用`); return }
  await api(`/accounts/${accountId}/r2/buckets`, { method: 'POST', body: JSON.stringify({ name }) })
  log(`R2 ${name} 已创建`)
}

// --- 生成部署配置 ---------------------------------------------------------

function injectTomlValue(text, section, key, value) {
  const start = text.indexOf(section)
  if (start < 0) throw new Error(`wrangler.toml 缺少配置段 ${section}`)
  const next = text.indexOf('\n[[', start + section.length)
  const end = next < 0 ? text.length : next
  const block = text.slice(start, end)
  const line = new RegExp(`^${key}\\s*=\\s*["'][^"']*["']\\s*$`, 'm')
  const updated = line.test(block)
    ? block.replace(line, `${key} = "${value}"`)
    : block.replace(/\n*$/, '\n') + `${key} = "${value}"\n`
  return text.slice(0, start) + updated + text.slice(end)
}

try {
  const d1Id = await ensureD1(d1Name)
  const kvId = await ensureKV(kvTitle)
  await ensureR2(r2Name)

  let output = injectTomlValue(sourceToml, '[[d1_databases]]', 'database_id', d1Id)
  output = injectTomlValue(output, '[[kv_namespaces]]', 'id', kvId)
  output = `# 由 scripts/setup-cloudflare.mjs 自动生成，请勿提交（已 gitignore）。\n# 内容 = wrangler.toml + 本次部署解析到的 D1 database_id / KV namespace id。\n${output}`
  writeFileSync(outputPath, output)

  log(`已生成 ${outputPath}（含 D1 database_id 与 KV id；R2 通过 bucket_name 绑定，无需 ID）`)
  log('资源准备完成。')
} catch (e) {
  console.error(`✖ 资源准备失败：${e?.message || e}`)
  console.error('请确认 API Token 具备 D1 Write / Workers KV Storage Edit / Workers R2 Storage Edit 权限，且 ACCOUNT_ID 正确。')
  process.exit(1)
}
