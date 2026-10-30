/**
 * 安全日志工具：生产环境自动脱敏敏感信息
 * - 移除 JWT、密码、API Key、邮箱、IP 等敏感字段
 * - 统一格式化，便于日志聚合分析
 */

export interface LogContext {
  [key: string]: unknown
}

/** 敏感字段关键词（不区分大小写） */
const SENSITIVE_KEYS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'jwt',
  'api[_-]?key',
  'apikey',
  'access[_-]?token',
  'refresh[_-]?token',
  'authorization',
  'cookie',
  'session',
  'csrf',
  'private[_-]?key',
  'credit[_-]?card',
  'ssn',
  'id[_-]?number',
  'phone',
  'mobile',
  'email',
  'ip',
  'address',
]

const SENSITIVE_REGEX = new RegExp(SENSITIVE_KEYS.join('|'), 'i')

/** 脱敏单个值 */
function sanitizeValue(key: string, value: unknown): unknown {
  const keyLower = String(key).toLowerCase()

  // 检查键名是否包含敏感词
  if (SENSITIVE_REGEX.test(keyLower)) {
    if (typeof value === 'string' && value.length > 0) {
      // 显示前2位和后2位，中间用 * 替代
      const v = value
      if (v.length <= 4) return '****'
      return v.slice(0, 2) + '*'.repeat(v.length - 4) + v.slice(-2)
    }
    return '[REDACTED]'
  }

  // 递归处理对象
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map(v => sanitizeValue(key, v))
    }
    const sanitized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      sanitized[k] = sanitizeValue(k, v)
    }
    return sanitized
  }

  return value
}

/** 脱敏整个上下文对象 */
export function sanitizeLogContext(context: LogContext): LogContext {
  const result: LogContext = {}
  for (const [key, value] of Object.entries(context)) {
    result[key] = sanitizeValue(key, value)
  }
  return result
}

/** 标准化日志条目 */
export interface LogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  context?: LogContext
  error?: { name: string; message: string; stack?: string }
}

/** 创建日志条目 */
export function createLogEntry(
  level: LogEntry['level'],
  message: string,
  context?: LogContext,
  error?: Error
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    context: context ? sanitizeLogContext(context) : undefined,
    error: error
      ? {
          name: error.name,
          message: error.message,
          stack:
          typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'
            ? error.stack
            : undefined,
        }
      : undefined,
  }
}

/** 控制台输出（带脱敏） */
function logToConsole(entry: LogEntry): void {
  const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`
  const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : ''
  const errorStr = entry.error ? ` :: ${entry.error.name}: ${entry.error.message}` : ''
  const line = `${prefix} ${entry.message}${contextStr}${errorStr}`

  switch (entry.level) {
    case 'error':
      console.error(line)
      break
    case 'warn':
      console.warn(line)
      break
    case 'info':
      console.info(line)
      break
    default:
      console.log(line)
  }
}

/** 导出的日志函数 */
export const logger = {
  debug: (message: string, context?: LogContext) =>
    logToConsole(createLogEntry('debug', message, context)),

  info: (message: string, context?: LogContext) =>
    logToConsole(createLogEntry('info', message, context)),

  warn: (message: string, context?: LogContext) =>
    logToConsole(createLogEntry('warn', message, context)),

  error: (message: string, context?: LogContext, error?: Error) =>
    logToConsole(createLogEntry('error', message, context, error)),
}

/** 兼容旧式 console.error 调用的包装器 */
export function safeError(message: string, error?: unknown, context?: LogContext): void {
  const err = error instanceof Error ? error : new Error(String(error))
  logger.error(message, context, err)
}

/** 兼容旧式 console.warn 调用的包装器 */
export function safeWarn(message: string, context?: LogContext): void {
  logger.warn(message, context)
}

/** 兼容旧式 console.info 调用的包装器 */
export function safeInfo(message: string, context?: LogContext): void {
  logger.info(message, context)
}
