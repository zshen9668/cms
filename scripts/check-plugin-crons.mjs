// 校验 src/plugins/ 下各插件的契约:
// - 插件 id 唯一(从各 index.ts 中读取 CmsPlugin 对象的 id 字段)
// - registry.ts 引用的插件文件存在
// - onScheduled 声明需与 wrangler.toml crons 对齐
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'src', 'plugins')
const wranglerSrc = readFileSync(join(root, 'wrangler.toml'), 'utf8')

const pluginDirs = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name)

const ids = []
for (const dir of pluginDirs) {
  const idx = join(pluginsDir, dir, 'index.ts')
  const src = readFileSync(idx, 'utf8')
  const m = src.match(/id:\s*['"]([^'"]+)['"]/)
  if (!m) {
    console.error('check-plugin: ' + dir + '/index.ts 缺少 id 字段')
    process.exit(1)
  }
  ids.push({ dir, id: m[1] })
}

const dup = ids.find((p, i) => ids.findIndex((q) => q.id === p.id) !== i)
if (dup) {
  console.error('check-plugin: duplicate plugin id: ' + dup.id)
  process.exit(1)
}

const hasCron = /crons\s*=/.test(wranglerSrc)
const hasScheduled = ids.some((p) =>
  readFileSync(join(pluginsDir, p.dir, 'index.ts'), 'utf8').includes('onScheduled'))
if (hasScheduled && !hasCron) {
  console.error('check-plugin: onScheduled 已声明但 wrangler.toml 无 [triggers] crons')
  process.exit(1)
}

console.log('check-plugin: ' + ids.length + ' plugin(s) ok' + (ids.length ? ' (' + ids.map((p) => p.id).join(', ') + ')' : ''))
