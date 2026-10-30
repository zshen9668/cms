// 创建/重置管理账号。
//
// 只生成 SQL：
//   node scripts/create-admin.mjs admin@example.com StrongPassword123
//
// 生成并直接执行到远程 D1（需要本机已登录 Cloudflare / 有有效 API Token）：
//   node scripts/create-admin.mjs admin@example.com StrongPassword123 admin --apply
//
// 也可以使用 npm：
//   npm run db:create-admin -- admin@example.com StrongPassword123 admin --apply
//
// 生成的是与 Worker 完全一致的 PBKDF2-SHA-256 哈希（pbkdf2$迭代$盐$哈希）。
// 付费计划想用更高迭代次数：PBKDF2_ITERATIONS=600000 node scripts/create-admin.mjs ...
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const [, , emailArg, password, roleArg = 'admin', flag] = process.argv
const email = String(emailArg || '').trim().toLowerCase()
const role = roleArg === 'manager' ? 'manager' : 'admin'

if (!email || !password) {
  console.error('用法: node scripts/create-admin.mjs <email> <password> [admin|manager] [--apply]')
  process.exit(1)
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('邮箱格式不正确')
  process.exit(1)
}
// 与 src/utils/password.ts 的 validatePasswordStrength 保持一致。
function passwordError(value, mail) {
  if (value.length < 10) return '密码至少 10 位'
  if (value.length > 128) return '密码不能超过 128 位'
  if (/^(.)\1+$/.test(value)) return '密码不能是同一个字符重复'
  const lower = value.toLowerCase()
  if (lower === mail || lower === mail.split('@')[0]) return '密码不能与登录邮箱相同'
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(value)).length
  if (classes < 2) return '密码需至少包含两类字符（大写、小写、数字、符号）'
  return null
}
const problem = passwordError(password, email)
if (problem) {
  console.error(problem)
  process.exit(1)
}

const requested = Number(process.env.PBKDF2_ITERATIONS)
const iterations = Number.isFinite(requested) && requested > 0
  ? Math.min(600000, Math.max(600000, Math.floor(requested)))
  : 600000
const salt = crypto.randomBytes(16)
const derived = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256')
const hash = `pbkdf2$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`
const sql = `INSERT INTO admin_users (email, password_hash, role) VALUES ('${email.replace(/'/g, "''")}', '${hash}', '${role}') ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role;`

if (flag !== '--apply') {
  console.log(sql)
  process.exit(0)
}

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['wrangler', 'd1', 'execute', 'DB', '--remote', '--command', sql],
  { stdio: 'inherit' }
)
process.exit(result.status ?? 1)
