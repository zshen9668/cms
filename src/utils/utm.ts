/** UTM 来源白名单校验（纯函数，便于单元测试）。
 * - 白名单为空：不校验，允许所有来源；
 * - utm_source 为空：不校验，允许提交；
 * - 否则：仅当 utm_source（不区分大小写）在名单内时允许。
 */
export function isUtmSourceAllowed(source: string, whitelist: string): boolean {
  const s = String(source || '').trim().toLowerCase()
  if (!s) return true
  if (!whitelist.trim()) return true
  const allowed = whitelist.split(/[,，;；、\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean)
  return allowed.includes(s)
}
