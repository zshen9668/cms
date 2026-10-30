#!/usr/bin/env node
/**
 * 检查 Contact Channels 字段迁移完整性。
 * 旧 contact_* 字段只能出现在合法的向后兼容读取/历史迁移位置。
 */
import fs from 'node:fs'
import path from 'node:path'

const allowedFiles = new Set([
  path.resolve('src/modules/contactChannels/service.ts'),
  path.resolve('src/modules/contactChannels/storage.ts'),
  path.resolve('src/utils/aiPrompts.ts'),
  path.resolve('migrations/0001_baseline.sql'),
  path.resolve('scripts/check-contact-fields.mjs'),
])

const legacyPattern = /\bcontact_(phone|phones|wechat|wechats|qqs)\b/gi
const files = [
  'src/templates/admin.ts',
  'src/routes/admin.ts',
  'src/utils/contactSettings.ts',
  'src/utils/aiPrompts.ts',
]

const violations = []

for (const file of files) {
  const absPath = path.resolve(file)
  if (allowedFiles.has(absPath) || !fs.existsSync(absPath)) continue
  const content = fs.readFileSync(absPath, 'utf8')
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!legacyPattern.test(line)) {
      legacyPattern.lastIndex = 0
      continue
    }
    legacyPattern.lastIndex = 0
    const trimmed = line.trim()
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')
    const isDeprecationNotice = line.includes('Deprecated') || line.includes('DEPRECATED') || line.includes('legacy')
    if (!isComment && !isDeprecationNotice) {
      violations.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`)
    }
  }
}

if (violations.length) {
  console.error('Contact fields migration check FAILED:')
  for (const violation of violations) console.error(` - ${violation}`)
  process.exit(1)
}

console.log('Contact fields migration OK: no unauthorized direct access to legacy fields')
