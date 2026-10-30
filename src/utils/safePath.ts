/**
 * 路径安全工具：防止路径遍历攻击
 * Cloudflare Workers 支持 nodejs_compat，可使用 path.posix
 */
import { normalize, relative } from 'path/posix'

/** 安全的基础目录前缀 */
export const MEDIA_BASE_PREFIX = 'media/'

/**
 * 规范化并验证媒体对象键
 * - 解码 URL 编码（防多重编码）
 * - 规范化路径（解析 . 和 ..）
 * - 确保在允许的前缀下
 * - 拒绝任何尝试逃逸的路径
 * - 严格字符集白名单
 */
export function resolveMediaKey(input: string): string | null {
  try {
    // 1. 循环解码直到稳定（防多重编码攻击）
    let decoded = input
    for (let i = 0; i < 5; i++) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }

    // 2. 严格字符集白名单：只允许 a-z A-Z 0-9 . - _ /
    if (!/^[a-zA-Z0-9._/-]+$/.test(decoded)) return null

    // 3. 规范化路径（posix 风格，R2 键使用 / 分隔）
    const normalized = normalize(decoded)

    // 4. 拒绝绝对路径、空路径、或包含 .. 的路径
    if (!normalized || normalized === '.' || normalized.startsWith('..') || normalized.startsWith('/')) {
      return null
    }

    // 5. 确保在 media/ 前缀下
    const fullKey = MEDIA_BASE_PREFIX + normalized
    const relativePath = relative(MEDIA_BASE_PREFIX, fullKey)
    if (relativePath.startsWith('..') || relativePath === '') {
      return null
    }

    return fullKey
  } catch {
    return null
  }
}

/**
 * 从 URL 路径提取并验证 media key
 * 用于 /media/* 和 /wechat-qr 等路由
 */
export function extractMediaKeyFromUrl(url: string | URL, prefix: string = '/media/'): string | null {
  try {
    const urlObj = typeof url === 'string' ? new URL(url) : url
    const pathname = urlObj.pathname
    if (!pathname.startsWith(prefix)) return null
    const rawKey = pathname.slice(prefix.length)
    return resolveMediaKey(rawKey)
  } catch {
    return null
  }
}