import type { D1Database } from '@cloudflare/workers-types'
import type { Bindings, TenantContext } from '../types'
import { scoped, type ScopedQuery } from './scoped'

/**
 * SaaS Phase 2：租户作用域数据访问封装
 * 安全规则：显式传入 tenantId + 参数化绑定，防止 SQL 注入
 * 用法（在 repo/service 中）：
 *   const db = scopedDb(c.env, c)        // 自动从 c 获取当前 tenantId
 *   const rows = await db.query(
 *     'SELECT id, name FROM cities WHERE is_active = 1 ORDER BY sort_order',
 *   ).all()
 *   // 自动生成  ... WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order
 *
 * 规则：
 * - 仅对带 WHERE 的 SELECT/UPDATE/DELETE 在 WHERE 后追加 tenant_id = ?；
 * - INSERT / 不带 WHERE 的 DML 不自动追加（INSERT 需显式写入 tenant_id，调用方用参数形式写入）
 * - 复杂 CTE / 多表不保证注入正确，请手写
 */
export class ScopedDb {
  private readonly db: D1Database
  private readonly tenantId: number

  constructor(db: D1Database, tenantId: number) {
    this.db = db
    this.tenantId = Number(tenantId)
  }

  get tenantIdValue(): number { return this.tenantId }

  /** 为带 WHERE 的查询自动追加 tenant_id = ? 参数化绑定 */
  query(sql: string) {
    const raw = String(sql || '').trim()
    let injected: ScopedQuery

    if (/^INSERT\b/i.test(raw)) {
      // INSERT 不自动注入，调用方需显式包含 tenant_id 字段与参数
      injected = { sql: raw, params: [] }
    } else if (/^WITH\b/i.test(raw)) {
      // CTE: a single top-level WHERE cannot scope every subquery. Refuse
      // loudly rather than silently returning an un-scoped CTE query.
      throw new Error('ScopedDb cannot auto-scope WITH/CTE queries; add "WHERE tenant_id = ?" to each subquery manually')
    } else if (/^SELECT\b|^UPDATE\b|^DELETE\b/i.test(raw)) {
      injected = scoped(raw, this.tenantId)
    } else {
      // 其他语句不自动处理
      injected = { sql: raw, params: [] }
    }

    const stmt = this.db.prepare(injected.sql)
    if (injected.params.length > 0) {
      return stmt.bind(...injected.params)
    }
    return stmt
  }

  /** 便捷方法：从请求上下文自动获取 tenantId 创建 scoped db */
  static for(c: { get: (key: string) => TenantContext | undefined }, env: Bindings): ScopedDb {
    const tenantId = c.get('tenant')?.id ?? 1
    return new ScopedDb(env.DB, tenantId)
  }
}
