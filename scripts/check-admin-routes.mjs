import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { cwd, exit } from 'node:process'

const root = cwd()
const snapshotPath = join(root, 'scripts', 'admin-routes.snapshot.json')
const routeFileRoot = join(root, 'src', 'routes')
const rootAdminFile = join(routeFileRoot, 'admin.ts')
const splitAdminRoot = join(routeFileRoot, 'admin')

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function listRouteFiles(dir) {
  const files = []
  if (!existsSync(dir)) return files
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await listRouteFiles(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
  }
  return files
}

function normalizeExpression(expr) {
  return expr
    .replace(/\s+/g, ' ')
    .replace(/\s*\+\s*/g, ' + ')
    .trim()
}

function joinRoutePath(prefix, path) {
  const left = String(prefix || '').trim().replace(/\/+$/, '')
  const right = String(path || '').trim()
  if (!left || left === '/') return right || '/'
  if (!right || right === '/') return left || '/'
  return left + '/' + right.replace(/^\/+/, '')
}

function expandRoute(method, expr, prefix) {
  const normalized = normalizeExpression(expr)
  const dynamicGroup = normalized.includes("'/page-images/' + group + '/:slug'")
  const dynamicDelete = normalized.includes("'/page-images/' + group + '/:slug/delete'")
  if (dynamicGroup) {
    return [
      { method, path: joinRoutePath(prefix, '/page-images/city/:slug') },
      { method, path: joinRoutePath(prefix, '/page-images/service/:slug') },
    ]
  }
  if (dynamicDelete) {
    return [
      { method, path: joinRoutePath(prefix, '/page-images/city/:slug/delete') },
      { method, path: joinRoutePath(prefix, '/page-images/service/:slug/delete') },
    ]
  }

  const literal = normalized.match(/^['"](\/[^'"]*)['"]$/)
  if (literal) return [{ method, path: joinRoutePath(prefix, literal[1]) }]
  return [{ method, path: joinRoutePath(prefix, '[dynamic:' + normalized + ']') }]
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = join(dirname(fromFile), specifier)
  const candidates = [
    base,
    base + '.ts',
    base + '.tsx',
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  // 必须确认是文件：`./routes/adminModules` 这类目录导入如果直接返回目录路径，
  // 后续 readFile 会抛 EISDIR。目录导入要落到它的 index.ts。
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) || null
}

function readImports(source, file) {
  const imports = new Map()
  let match

  const namedRe = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g
  while ((match = namedRe.exec(source))) {
    const target = resolveImport(file, match[2])
    if (!target) continue
    for (const item of match[1].split(',')) {
      const part = item.trim()
      if (!part) continue
      const bits = part.split(/\s+as\s+/)
      const imported = bits[0].trim()
      const local = (bits[1] || imported).trim()
      imports.set(local, target)
    }
  }

  const defaultRe = /import\s+([A-Za-z0-9_$]+)\s+from\s*['"]([^'"]+)['"]/g
  while ((match = defaultRe.exec(source))) {
    const target = resolveImport(file, match[2])
    if (target) imports.set(match[1], target)
  }

  const namespaceRe = /import\s*\*\s*as\s+([A-Za-z0-9_$]+)\s*from\s*['"]([^'"]+)['"]/g
  while ((match = namespaceRe.exec(source))) {
    const target = resolveImport(file, match[2])
    if (target) imports.set(match[1], target)
  }

  return imports
}

async function collectFromModule(file, routerName, prefix, stack, unresolvedMounts, routes) {
  const key = relative(root, file) + '::' + routerName + '::' + prefix
  if (stack.has(key)) return
  stack.add(key)

  const source = await readFile(file, 'utf8')
  // 导出名可能与文件内部的 Hono 变量名不同（例如 `export const adminRoutes = ADMIN_ROUTES`）。
  // 不解析别名的话，按导出名去匹配 `adminRoutes.get(...)` 会一条都匹配不到，
  // 该模块的路由就静默从快照里消失。
  const aliasMatch = new RegExp('export\\s+const\\s+' + escapeRegExp(routerName) + '\\s*=\\s*(?!new\\b)([A-Za-z0-9_$]+)').exec(source)
  const effectiveName = aliasMatch ? aliasMatch[1] : routerName
  const routerRe = new RegExp('\\b' + escapeRegExp(effectiveName) + '\\.(get|post|put|patch|delete)\\(([^,\n]+),', 'g')
  let match
  while ((match = routerRe.exec(source))) {
    routes.push(...expandRoute(match[1].toUpperCase(), match[2], prefix))
  }

  const imports = readImports(source, file)
  const mountRe = /\b([A-Za-z0-9_$]+)\.route\(\s*['"]([^'"]*)['"]\s*,\s*([A-Za-z0-9_$]+)\s*\)/g
  while ((match = mountRe.exec(source))) {
    if (match[1] !== routerName) continue
    const childRouter = match[3]
    const childFile = imports.get(childRouter)
    if (!childFile) {
      unresolvedMounts.push({
        file: relative(root, file).split(sep).join('/'),
        mount: match[0],
        reason: 'unable to resolve imported route module',
      })
      continue
    }
    await collectFromModule(
      childFile,
      childRouter,
      joinRoutePath(prefix, match[2] || '/'),
      stack,
      unresolvedMounts,
      routes,
    )
  }

  stack.delete(key)
}

async function collect() {
  // Admin 路由入口：优先使用拆分后的 src/routes/admin/index.ts（adminRoutes 聚合器），
  // 兼容历史上仍存在的单体 src/routes/admin.ts。
  const entryFile = existsSync(splitAdminRoot && join(splitAdminRoot, 'index.ts'))
    ? join(splitAdminRoot, 'index.ts')
    : rootAdminFile
  if (!existsSync(entryFile)) throw new Error('Missing admin route entry (src/routes/admin/index.ts or src/routes/admin.ts)')

  const routes = []
  const unresolvedMounts = []
  await collectFromModule(entryFile, 'adminRoutes', '', new Set(), unresolvedMounts, routes)

  // Split modules are traversed only when they are mounted through adminRoutes.route(...).
  // An unmounted module is not an active admin route and is therefore intentionally absent from the snapshot.

  // 插件路由（src/plugins/*/index.ts）：静态扫描 mount() 里的 app.route(...) 调用。
  // 各插件把 admin 端路由挂在 /admin（app.route('/admin', routes)）或挂在 /（app.route('/', routes)），
  // 这里的 router 是插件文件内部定义的 Hono 实例，routerName 取各插件里 `const routes = new Hono(...)`
  // 声明的局部变量名；analytics/versioning/forms/rbac/apiKeys 均如此。
  const pluginRoot = join(root, 'src', 'plugins')
  const pluginFiles = []
  if (existsSync(pluginRoot)) {
    const pluginEntries = await readdir(pluginRoot, { withFileTypes: true })
    for (const entry of pluginEntries) {
      if (entry.isDirectory()) {
        const indexFile = join(pluginRoot, entry.name, 'index.ts')
        if (existsSync(indexFile)) pluginFiles.push(indexFile)
      }
    }
  }
  // 各插件内部使用的 Hono router 变量名（均为 `const routes = new Hono(...)`）
  const pluginRouterNames = ['routes', 'publicRoutes']
  for (const pluginFile of pluginFiles) {
    // 找到该文件里挂载 admin 侧路由的 mount() 中 app.route('<prefix>', <router>) 的 prefix
    const source = await readFile(pluginFile, 'utf8')
    // 匹配 mount(app) { app.route('/xxx', routerName) } 形式，routerName 在 pluginRouterNames 中
    const mountRouteRe = /mount\s*\([^)]*\)\s*\{[\s\S]*?app\.route\(\s*['"]([^'"]*)['"]\s*,\s*([A-Za-z0-9_$]+)\s*\)/g
    let match
    while ((match = mountRouteRe.exec(source))) {
      const mountPrefix = match[1]   // '/admin' 或 '/'
      const routerVar = match[2]
      if (!pluginRouterNames.includes(routerVar)) continue
      // 只收集 admin 侧的挂载：prefix 以 /admin 开头，或 prefix 为 / 且 routerVar === 'routes'
      const isAdminMount = mountPrefix.startsWith('/admin') || (mountPrefix === '/' && routerVar === 'routes')
      if (!isAdminMount) continue
      const fullPrefix = mountPrefix
      await collectFromModule(pluginFile, routerVar, fullPrefix, new Set(), unresolvedMounts, routes)
    }
  }

  // 直接挂在 src/index.ts 上的 admin 子路由（app.route('/admin/xxx', router)）。
  // 这些模块不经过 adminRoutes 聚合器，也不在 plugins 目录里，之前完全没被扫描到——
  // 结果是 /admin/modules/* 这类独立挂载的路由漂移（改错前缀、被删掉）
  // 快照都不会报错，而它们在后台导航里是真实入口。
  const entrySource = await readFile(join(root, 'src', 'index.ts'), 'utf8')
  const entryImports = readImports(entrySource, join(root, 'src', 'index.ts'))
  const directMountRe = /app\.route\(\s*['"](\/admin[^'"]*)['"]\s*,\s*([A-Za-z0-9_$]+)\s*\)/g
  let directMatch
  while ((directMatch = directMountRe.exec(entrySource))) {
    const mountPrefix = directMatch[1]
    const routerVar = directMatch[2]
    // 裸 '/admin' 是 adminRoutes 聚合器本身，上面已经用空前缀收集过；
    // 这里再收一次会产出整套重复的 /admin/... 路径。
    if (mountPrefix === '/admin') continue
    const childFile = entryImports.get(routerVar)
    if (!childFile) {
      unresolvedMounts.push({
        file: 'src/index.ts',
        mount: directMatch[0],
        reason: 'unable to resolve imported route module',
      })
      continue
    }
    // 快照统一用「相对 /admin 的路径」：adminRoutes 聚合器以空前缀收集，
    // 这里也要把 '/admin/modules' 归一成 '/modules'，否则同一份快照里
    // 会混着 '/seo' 与 '/admin/modules' 两种写法，比对和审计都会错位。
    const relativePrefix = mountPrefix.replace(/^\/admin/, '')
    await collectFromModule(childFile, routerVar, relativePrefix, new Set(), unresolvedMounts, routes)
  }


  const seen = new Map()
  const duplicates = []
  for (const route of routes) {
    const key = route.method + ' ' + route.path
    if (seen.has(key)) duplicates.push({ key, first: seen.get(key), duplicate: route })
    else seen.set(key, route)
  }

  const normalized = Array.from(seen.keys()).sort().map((key) => {
    const [method, ...rest] = key.split(' ')
    // 统一成「相对 /admin 的路径」：插件与直挂模块是按绝对前缀收集的
    // （/admin/forms、/admin/analytics），adminRoutes 聚合器是相对收集的（/seo）。
    // 不归一化的话，同一份快照里两种写法混用，NAV 审计会误报"点了会 404"。
    const path = rest.join(' ').replace(/^\/admin(?=\/|$)/, '') || '/'
    return { method, path }
  })
  return { routes: normalized, duplicates, unresolvedMounts }
}

const current = await collect()
if (!current.routes.length) {
  console.error('No admin routes found.')
  exit(1)
}
if (current.unresolvedMounts.length) {
  console.error('Unresolved admin route mounts:')
  console.error(JSON.stringify(current.unresolvedMounts, null, 2))
  exit(1)
}
if (current.duplicates.length) {
  console.error('Duplicate admin routes found:')
  console.error(JSON.stringify(current.duplicates, null, 2))
  exit(1)
}

if (process.argv.includes('--update')) {
  await writeFile(snapshotPath, JSON.stringify(current.routes, null, 2) + '\n')
  console.log('Updated ' + relative(root, snapshotPath))
  exit(0)
}

if (!existsSync(snapshotPath)) {
  console.error('Missing route snapshot: ' + relative(root, snapshotPath))
  console.error('Run: node scripts/check-admin-routes.mjs --update')
  exit(1)
}

const expected = JSON.parse(await readFile(snapshotPath, 'utf8'))
const actualText = JSON.stringify(current.routes)
const expectedText = JSON.stringify(expected)
if (actualText !== expectedText) {
  console.error('Admin route snapshot mismatch.')
  console.error('Expected: ' + expectedText)
  console.error('Actual: ' + actualText)
  console.error('Run --update only when a route change is intentional, then review the snapshot diff.')
  exit(1)
}

console.log('Admin route snapshot OK: ' + current.routes.length + ' routes')
