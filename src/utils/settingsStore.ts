/**
 * SettingsStore：settings 表的统一读写入口
 * 所有 settings 的 SELECT / INSERT / DELETE 都走这里
 * 将键名规范、租户隔离、默认值、加密字段收敛到同一层
 *
 * 约定：
 * - key 的命名规范见 settingsSchema.ts（scope 划分）
 * - 机密类 key（secret:*）必须配合 protectedSecrets.ts 使用，Store 本身不加密
 * - 动态键（如 ai_page:cities:xxx、news_source_analysis:xxx）不登记进 schema
 *   调用 keysByPrefix / deleteByPrefix 统一治理
 */
import type { Bindings } from '../types'
import { keysForScope } from './settingsSchema'
import { scoped } from '../db/scoped'

type DbLike = Pick<Bindings, 'DB'>

export class SettingsStore {
  private readonly db: DbLike['DB']
  private readonly tenantId: number | null
  private constructor(db: DbLike['DB'], tenantId: number | null = null) {
    this.db = db
    this.tenantId = tenantId
  }

  /** 默认租户（tenant_id=1）的全局 store，兼容旧调用点 */
  static for(env: DbLike): SettingsStore {
    if (!env.DB) throw new Error('SettingsStore requires DB binding')
    return new SettingsStore(env.DB)
  }

  /** 指定租户的 store，所有读写自动带上 tenant_id */
  static forTenant(env: DbLike, tenantId: number): SettingsStore {
    if (!env.DB) throw new Error('SettingsStore requires DB binding')
    return new SettingsStore(env.DB, Number(tenantId))
  }

  // 内部：把 tenant_id 条件拼到查询里。null = 不限制租户（默认租户兼容模式）
  private buildQuery(baseSql: string): { sql: string; params: unknown[] } {
    if (this.tenantId == null) return { sql: baseSql, params: [] }
    // 复用 db/scoped.ts 的顶层 WHERE 定位（跳过子查询与字符串字面量），
    // 不再自实现朴素正则——那会把 WHERE 找在子查询或字面量里，注错位置。
    const q = scoped(baseSql, this.tenantId)
    return { sql: q.sql, params: q.params }
  }

  /** 单键读取；未配置时返回 fallback */
  async get<T = string>(key: string, fallback?: T): Promise<T | undefined> {
    const { sql, params } = this.buildQuery('SELECT value FROM settings WHERE key=?')
    const binds = [...params, key]
    const row = await this.db.prepare(sql).bind(...binds).first() as any
    const raw = row?.value == null ? undefined : String(row.value)
    return raw === undefined ? fallback : (raw as unknown as T)
  }

  /** 批量读取；仅返回已配置的键 */
  async getMany(keys: readonly string[]): Promise<Record<string, string>> {
    if (!keys.length) return {}
    const ph = keys.map(() => '?').join(',')
    const baseSql = `SELECT key, value FROM settings WHERE key IN (${ph})`
    const { sql, params } = this.buildQuery(baseSql)
    const binds = [...params, ...keys]
    const rows = (await this.db.prepare(sql).bind(...binds).all()).results as any[]
    const out: Record<string, string> = {}
    for (const r of rows) out[String(r.key)] = String(r.value ?? '')
    return out
  }

  /** 读整张设置表（排除 ai_page:%），按 scope 过滤 */
  async getMap(scope: 'public' | 'profile' | 'ai' | 'runtime' | 'all' = 'all'): Promise<Record<string, string>> {
    const baseSql = `SELECT key, value FROM settings WHERE key NOT LIKE 'ai_page:%'`
    const { sql, params } = this.buildQuery(baseSql)
    const rows = (await this.db.prepare(sql).bind(...params).all()).results as any[]
    const keys = scope === 'all' ? null : keysForScope(scope)
    const out: Record<string, string> = {}
    for (const r of rows) {
      const k = String(r.key || '')
      if (!k) continue
      if (keys && !keys.includes(k as any)) continue
      out[k] = String(r.value ?? '')
    }
    return out
  }

  /** 读整张设置表（排除指定前缀） */
  async getMapExcluding(prefixes: readonly string[]): Promise<Record<string, string>> {
    if (prefixes.length === 0) return this.getMap('all')
    const conds = prefixes.map(() => `key NOT LIKE ?`).join(' AND ')
    const baseSql = `SELECT key, value FROM settings WHERE ${conds}`
    const { sql, params } = this.buildQuery(baseSql)
    const binds = [...params, ...prefixes.map(p => p + '%')]
    const rows = (await this.db.prepare(sql).bind(...binds).all()).results as any[]
    const out: Record<string, string> = {}
    for (const r of rows) out[String(r.key || '')] = String(r.value ?? '')
    return out
  }

  /** 写入单键（自动 String() 转换）。
   * settings 表自 0030 起为 (key, tenant_id) 复合主键，任何 upsert 的冲突目标都必须是完整主键：
   * - tenantId != null：写入并冲突于该租户自身行；
   * - tenantId == null（默认租户兼容模式）：显式写 tenant_id=1 行，与读取(get 不带 tenant 过滤)语义一致。 */
  async set(key: string, value: unknown): Promise<void> {
    const baseSql = 'INSERT INTO settings (key, value, tenant_id) VALUES (?, ?, ?) ON CONFLICT(key, tenant_id) DO UPDATE SET value=excluded.value'
    const binds = [key, String(value ?? ''), this.tenantId ?? 1]
    await this.db.prepare(baseSql).bind(...binds).run()
  }

  /** 批量写入（事务 batch，原子性） */
  async batch(entries: Array<[string, unknown]>): Promise<void> {
    if (!entries.length) return
    const baseSql = 'INSERT INTO settings (key, value, tenant_id) VALUES (?, ?, ?) ON CONFLICT(key, tenant_id) DO UPDATE SET value=excluded.value'
    const tenantId = this.tenantId ?? 1
    await this.db.batch(entries.map(([k, v]) =>
      this.db.prepare(baseSql).bind(k, String(v ?? ''), tenantId)
    ))
  }

  /** 删除单键（幂等，不存在不报错） */
  async delete(key: string): Promise<void> {
    const { sql, params } = this.buildQuery('DELETE FROM settings WHERE key=?')
    const binds = [...params, key]
    await this.db.prepare(sql).bind(...binds).run()
  }

  /** 批量删除 */
  async deleteMany(keys: readonly string[]): Promise<void> {
    if (!keys.length) return
    const { sql, params } = this.buildQuery('DELETE FROM settings WHERE key=?')
    await this.db.batch(keys.map(k =>
      this.db.prepare(sql).bind(...[...params, k])
    ))
  }

  /** 按前缀删除（如 'ai_page:cities:%' 动态键清理） */
  async deleteByPrefix(prefix: string): Promise<void> {
    const { sql, params } = this.buildQuery('DELETE FROM settings WHERE key LIKE ?')
    const binds = [...params, prefix + '%']
    await this.db.prepare(sql).bind(...binds).run()
  }

  /** 按前缀查键名（用于动态键治理） */
  async keysByPrefix(prefix: string): Promise<string[]> {
    const { sql, params } = this.buildQuery('SELECT key FROM settings WHERE key LIKE ?')
    const binds = [...params, prefix + '%']
    const rows = (await this.db.prepare(sql).bind(...binds).all()).results as any[]
    return rows.map(r => String(r.key || '')).filter(Boolean)
  }

  /** 仅当键已存在时更新（用于读-改-写回且不想创建新键的场景） */
  async updateIf(key: string, value: unknown): Promise<void> {
    const baseSql = this.tenantId == null
      ? 'UPDATE settings SET value=? WHERE key=?'
      : 'UPDATE settings SET value=? WHERE tenant_id=? AND key=?'
    const realBinds = this.tenantId == null ? [String(value ?? ''), key] : [String(value ?? ''), this.tenantId, key]
    await this.db.prepare(baseSql).bind(...realBinds).run()
  }
}