// 后台模板拆分一致性校验。
//
// 背景：原先后台全部页面模板挤在单个 src/templates/admin.ts（2662 行）。按导航分组
// 拆成 8 个同域模块后，出现了一类新的失败模式——**barrel 里导出的名字在模块里不存在**、
// 或者**同一个模板函数被两个模块各定义一份**。这两类问题里，前者会被 tsc 拦住，
// 但后者（重复实现）不会报错，只会让"改了一处、另一处没改"的 bug 长期潜伏；
// 而 ADMIN_MODULES 这份域划分说明一旦过期，下一个接手的人就会照着错的目录找文件。
//
// 因此这里断言三件事：
//   1. barrel 里每一条 `export { ... } from './x'` 都指向真实存在的模块文件；
//   2. 每个导出名在该模块里确实以 `export function 名字(` 定义；
//   3. barrel 里的 export 清单与模块内的 ADMIN_MODULES 声明完全一致，且没有跨模块重名。
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const barrelPath = path.join(root, 'src/templates/admin.ts')
const barrel = fs.readFileSync(barrelPath, 'utf8')
const problems = []
const fail = (message) => problems.push(message)

// --- 1 & 2：解析 barrel 的转发导出，逐个落到模块文件上 ---------------------

const exportRe = /export\s*\{([^}]+)\}\s*from\s*'\.\/([A-Za-z0-9_]+)'/g
const declared = new Map() // 模块名 -> [函数名]
const owner = new Map()    // 函数名 -> 模块名
let match
while ((match = exportRe.exec(barrel))) {
  const moduleName = match[2]
  const names = match[1].split(',').map((n) => n.trim()).filter(Boolean)
  const file = path.join(root, 'src/templates', moduleName + '.ts')
  if (!fs.existsSync(file)) {
    fail(`barrel 导出的模块文件不存在: src/templates/${moduleName}.ts`)
    continue
  }
  const text = fs.readFileSync(file, 'utf8')
  for (const name of names) {
    if (!new RegExp('^export function ' + name + '\\(', 'm').test(text)) {
      fail(`src/templates/${moduleName}.ts 未定义导出的模板函数: ${name}`)
    }
    if (owner.has(name)) {
      fail(`模板函数 ${name} 同时出现在两个模块: ${owner.get(name)} 与 ${moduleName}`)
    } else {
      owner.set(name, moduleName)
    }
  }
  declared.set(moduleName, names)
}

if (!declared.size) fail('src/templates/admin.ts 里没有任何转发导出 —— barrel 结构可能被改坏了')

// --- 3：ADMIN_MODULES 声明必须与真实导出一致 ------------------------------

const modulesBlock = /export const ADMIN_MODULES = \{([\s\S]*?)\n\} as const/.exec(barrel)
if (!modulesBlock) {
  fail('src/templates/admin.ts 缺少 ADMIN_MODULES 声明（后台模板域划分的唯一真相源）')
} else {
  const declaredModules = new Map()
  const entryRe = /([A-Za-z0-9_]+)\s*:\s*\[([^\]]*)\]/g
  let entry
  while ((entry = entryRe.exec(modulesBlock[1]))) {
    const names = entry[2].split(',').map((n) => n.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    declaredModules.set(entry[1], names)
  }
  for (const [moduleName, names] of declared) {
    const docs = declaredModules.get(moduleName)
    if (!docs) {
      fail(`ADMIN_MODULES 缺少模块 ${moduleName}`)
      continue
    }
    const missing = names.filter((n) => !docs.includes(n))
    const extra = docs.filter((n) => !names.includes(n))
    if (missing.length) fail(`ADMIN_MODULES.${moduleName} 缺少: ${missing.join(', ')}`)
    if (extra.length) fail(`ADMIN_MODULES.${moduleName} 多出未导出的名字: ${extra.join(', ')}`)
  }
  for (const moduleName of declaredModules.keys()) {
    if (!declared.has(moduleName)) fail(`ADMIN_MODULES 声明了未被 barrel 导出的模块: ${moduleName}`)
  }
}

// --- 附加红线：域模块不得自己重新实现后台外壳 ------------------------------
// 每个后台页面都必须走同一个 renderAdminLayout，否则移动端抽屉、CSRF 相关的
// 页面级增强、以及导航高亮会各写一套。

for (const moduleName of declared.keys()) {
  if (moduleName === 'adminLayout') continue
  const text = fs.readFileSync(path.join(root, 'src/templates', moduleName + '.ts'), 'utf8')
  if (/^export function renderAdminLayout\(/m.test(text)) {
    fail(`src/templates/${moduleName}.ts 重复实现了 renderAdminLayout —— 应统一使用 ./adminLayout 的实现`)
  }
  if (!/from '\.\/adminLayout'/.test(text)) {
    fail(`src/templates/${moduleName}.ts 未从 ./adminLayout 引入后台外壳`)
  }
}

if (problems.length) {
  console.error('后台模板结构校验失败：')
  for (const problem of problems) console.error(' - ' + problem)
  process.exit(1)
}

const total = [...declared.values()].reduce((sum, names) => sum + names.length, 0)
console.log(`后台模板结构 OK: ${declared.size} 个域模块、${total} 个模板函数、ADMIN_MODULES 一致`)
