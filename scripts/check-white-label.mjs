import fs from 'node:fs'
import path from 'node:path'

// Scan executable/runtime/template/deployment inputs only.
// Audit documentation may name historical industry terms while explicitly recording that
// those terms were removed; treating docs as runtime residue creates false positives.
const roots = ['src', 'migrations', 'scripts', 'public', '.github', 'wrangler.toml', 'package.json', '.dev.vars.example', '.nvmrc', '.node-version']
const extensions = new Set(['.ts', '.mts', '.mjs', '.js', '.json', '.sql', '.md', '.yml', '.yaml', '.toml', '.txt', '.css', '.html'])

function filesIn(target) {
  const absolute = path.resolve(target)
  if (!fs.existsSync(absolute)) return []
  if (fs.statSync(absolute).isFile()) return [absolute]
  const result = []
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const child = path.join(absolute, entry.name)
    if (entry.isDirectory()) result.push(...filesIn(child))
    else if (extensions.has(path.extname(entry.name))) result.push(child)
  }
  return result
}

const files = roots.flatMap(filesIn)

const cp = (hex) => String.fromCodePoint(...hex.split(' ').map((v) => Number.parseInt(v, 16)))
const legacyDomain = new RegExp(cp('73 7a 66 70 38 2e 63 6f 6d').replace('.', '\\.'), 'i')
const chineseLegacy = new RegExp([
  cp('8d22 7a0e'),
  cp('7a0e 52a1'),
  cp('7a0e 6536'),
  cp('4f1a 8ba1'),
  cp('53d1 7968'),
  cp('8bb0 8d26'),
  cp('88c5 4fee'),
  cp('4ee3 5f00'),
  cp('5de5 5546 670d 52a1'),
  cp('4e13 4e1a 53ef 9760'),
].join('|'))
const englishLegacy = new RegExp([
  cp('74 61 78'),
  cp('74 61 78 61 74 69 6f 6e'),
  cp('61 63 63 6f 75 6e 74 69 6e 67'),
  cp('62 6f 6f 6b 6b 65 65 70 69 6e 67'),
].map((v) => '\\b' + v + '\\b').join('|'), 'i')
const legacySource = new RegExp(
  cp('63 68 69 6e 61 74 61 78 2e 67 6f 76 2e 63 6e').replaceAll('.', '\\.') ,
  'i',
)

const rules = [
  { label: 'legacy domain/brand', re: legacyDomain },
  { label: 'legacy Chinese industry content', re: chineseLegacy },
  { label: 'legacy English industry content', re: englishLegacy },
  { label: 'legacy source hostname', re: legacySource },
]

const hits = []
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8')
  for (const rule of rules) {
    if (rule.re.test(content)) hits.push(`${path.relative(process.cwd(), file)} -> ${rule.label}`)
  }
}

if (hits.length) {
  console.error('White-label baseline check failed:')
  for (const hit of hits) console.error(' - ' + hit)
  process.exit(1)
}
console.log(`White-label baseline OK: scanned ${files.length} text files`)
