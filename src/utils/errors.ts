/** Convert unknown caught values into a stable, human-readable error message. */
export function errorMessage(error: unknown, fallback = '未知错误'): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error == null) return fallback

  try {
    const serialized = JSON.stringify(error)
    if (serialized && serialized !== '{}') return serialized
  } catch {
    // Ignore serialization failures and use String below.
  }

  const stringified = String(error ?? '').trim()
  return stringified || fallback
}
