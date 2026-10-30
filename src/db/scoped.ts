import type { TenantContext } from '../types'

/**
 * 租户作用域数据访问辅助 (Phase 1)
 * 推荐模式：所有 repo/service 函数首参传入 tenantId
 * helper 安全生成 "SELECT ... WHERE tenant_id = ?" 的参数化查询，防止 SQL 注入
 */
export interface ScopedQuery {
  sql: string
  params: unknown[]
}

/**
 * 安全地为 SQL 注入 tenant_id 过滤，返回参数化查询
 * 使用 ? 占位符防止 SQL 注入
 */
export function scoped(sql: string, tenantId: number): ScopedQuery {
  const s = String(sql || '').trim()
  const t = Number(tenantId)
  if (!Number.isInteger(t) || t <= 0) {
    throw new Error('Invalid tenantId: must be a positive integer')
  }
  // WITH/CTE check must run first: a single top-level WHERE cannot scope
  // every subquery in a CTE (each may read a shared table), and a
  // WITH-prefixed statement would otherwise fall into the passthrough below
  // and return with NO tenant scoping at all. Refuse loudly instead.
  if (/^WITH\b/i.test(s)) {
    throw new Error('scoped() cannot auto-inject tenant_id for WITH/CTE queries; add "WHERE tenant_id = ?" to each subquery manually')
  }
  // Only auto-scope data-access statements; leave anything else untouched so
  // we never append a dangling WHERE to INSERT/PRAGMA/etc.
  if (!/^(SELECT|UPDATE|DELETE)\b/i.test(s)) {
    return { sql: s, params: [] }
  }
  // Inject at the first TOP-LEVEL WHERE only (depth 0, ignoring string
  // literals and nested subqueries). The old first-regex match could land
  // inside a subquery, a CTE, or even a string literal like WHERE 'WHERE'.
  const idx = topLevelWhereIndex(s)
  if (idx === -1) {
    return { sql: s + ' WHERE tenant_id = ?', params: [t] }
  }
  return {
    sql: `${s.slice(0, idx + 5)} tenant_id = ? AND${s.slice(idx + 5)}`,
    params: [t],
  }
}

/**
 * Index of the first top-level WHERE keyword in a SQL statement, or -1.
 * Tracks paren depth (so nested subqueries / CTE bodies are skipped) and
 * string-literal state (so a literal 'WHERE' / "WHERE" never counts).
 * Case-insensitive; WHERE must be a whole word.
 */
function topLevelWhereIndex(sql: string): number {
  const isWord = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9_$]/.test(ch)
  let depth = 0
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (inSingle) {
      if (ch === "'") {
        if (sql[i + 1] === "'") i++ // escaped quote ('') inside a string
        else inSingle = false
      }
      continue
    }
    if (inDouble) {
      if (ch === '"') inDouble = false
      continue
    }
    if (ch === "'") { inSingle = true; continue }
    if (ch === '"') { inDouble = true; continue }
    if (ch === '(') { depth++; continue }
    if (ch === ')') { if (depth > 0) depth--; continue }
    if (depth === 0 && (ch === 'W' || ch === 'w') && sql.slice(i, i + 5).toUpperCase() === 'WHERE') {
      const prevOk = i === 0 || !isWord(sql[i - 1])
      const nextOk = i + 5 >= sql.length || !isWord(sql[i + 5])
      if (prevOk && nextOk) return i
    }
  }
  return -1
}

/** 获取当前请求的 tenantId，默认租户 = 1 */
export function getTenantId(c: { get: (key: string) => TenantContext | undefined }): number {
  return c.get('tenant')?.id ?? 1
}
