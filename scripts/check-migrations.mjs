// 校验 D1 migrations 命名：
//  - 文件名必须是 NNNN_name.sql；
//  - 编号从 0001 开始且必须连续，避免漏文件；
//  - 编号不允许重复。
//
// 说明：早期版本有 38 个增量迁移（0001~0038），其中 0017 引用了 0036 才创建的表，
// 在全新 D1 上必然中断，是两套部署方案共同失败的直接原因。现已合并为
// 0001_baseline.sql（完整幂等 schema）+ 0002_seed.sql（幂等种子数据）。
// D1 按文件名记录已执行的迁移，所以以后新增迁移必须接在现有最大编号之后（当前 0005），
// 不能重命名历史文件。
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve('migrations')
const files = fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
const errors = []
const seen = new Map()

for (const file of files) {
  const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(file)
  if (!match) {
    errors.push(`${file}: 文件名必须形如 0001_name.sql（小写字母、数字、下划线）`)
    continue
  }
  const number = match[1]
  if (!seen.has(number)) seen.set(number, [])
  seen.get(number).push(file)
}

for (const [number, names] of seen) {
  if (names.length > 1) {
    errors.push(`编号 ${number} 重复：${names.join(', ')}。请给新 migration 使用下一个未用编号。`)
  }
}

const numbers = [...seen.keys()].map(Number).sort((a, b) => a - b)

if (numbers.length === 0) {
  errors.push('migrations/ 下没有任何 .sql 文件')
} else {
  if (numbers[0] !== 1) {
    errors.push(`编号必须从 0001 开始，当前最小是 ${String(numbers[0]).padStart(4, '0')}`)
  }
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] - numbers[i - 1] > 1) {
      errors.push(`编号不连续：${String(numbers[i - 1]).padStart(4, '0')} 之后直接是 ${String(numbers[i]).padStart(4, '0')}`)
    }
  }
}

if (errors.length) {
  console.error('Migration 命名检查失败：')
  for (const error of errors) console.error(' - ' + error)
  process.exit(1)
}
console.log(`Migration 命名 OK: ${files.length} 个文件，最新编号 ${String(numbers.at(-1)).padStart(4, '0')}`)
