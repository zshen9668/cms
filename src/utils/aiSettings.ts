import { safeError, safeWarn } from './safeLogger'
import type { Bindings } from '../types'
import { getSystemSecret } from './systemSecrets'
import { SettingsStore } from './settingsStore'

export type AiProviderType = 'workers_ai' | 'openai_compatible'

export const DEFAULT_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast'
export const DEFAULT_AI_TEMPERATURE = 0.6
export const DEFAULT_AI_MAX_TOKENS = 4096
export const AI_MAX_TOKENS_CEILING = 32768
export const DEFAULT_AI_TIMEOUT_MS = 20000
export const DEFAULT_AI_ENABLED = true
export const DEFAULT_AI_PROVIDER: AiProviderType = 'workers_ai'

export const AI_MODEL_OPTIONS = [
  { id: '@cf/meta/llama-3.1-8b-instruct-fast', label: 'Llama 3.1 8B Fast（当前默认）', note: '速度快，适合批量新闻/城市/服务/文章生成' },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B Fast', note: '更强的长文本理解与生成能力，资源消耗更高' },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B', note: '新一代多模态模型，可用于较复杂内容生成' },
  { id: '@cf/meta/llama-3.1-8b-instruct-fp8', label: 'Llama 3.1 8B FP8', note: '标准 Cloudflare 托管版本' },
] as const

export const EXTERNAL_AI_PRESETS = [
  { id: 'glm', label: '智谱 GLM-4-Flash(免费层)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'siliconflow', label: '硅基流动 Qwen2.5-7B(免费层)', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  { id: 'groq', label: 'Groq Llama 3.3 70B(免费层)', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
] as const

export type AiSettings = {
  enabled: boolean
  provider: AiProviderType
  model: string
  temperature: number
  maxTokens: number
  externalBaseUrl: string
  externalModel: string
  externalTimeoutMs: number
  fallbackEnabled: boolean
  webSearchEnabled: boolean
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeModel(value: unknown): string {
  const model = String(value || '').trim().slice(0, 180)
  if (/^@(cf|hf)\/[A-Za-z0-9._/@:-]+$/.test(model)) return model
  return DEFAULT_AI_MODEL
}

function normalizeExternalBaseUrl(value: unknown): string {
  const raw = String(value || '').trim().replace(/\/+$/, '')
  if (!raw || raw.length > 500) return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return ''
    if (url.username || url.password || url.search || url.hash) return ''
    if (/^(localhost|.*\.local|.*\.internal)$/i.test(url.hostname)) return ''
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)) return ''
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname)) return ''
    if (url.hostname === '0.0.0.0' || url.hostname.startsWith('[') || url.hostname === '::1' || url.hostname.startsWith('fc') || url.hostname.startsWith('fd')) return ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function normalizeExternalModel(value: unknown): string {
  return String(value || '').trim().replace(/[^A-Za-z0-9._:@/-]/g, '').slice(0, 180)
}

function normalizeProvider(value: unknown): AiProviderType {
  return value === 'openai_compatible' ? 'openai_compatible' : DEFAULT_AI_PROVIDER
}

export function normalizeAiSettings(input: Partial<AiSettings> & {
  customModel?: unknown
  aiProvider?: unknown
  externalModel?: unknown
  externalBaseUrl?: unknown
  externalTimeoutMs?: unknown
  fallbackEnabled?: unknown
}): AiSettings {
  const selected = String(input.model || '').trim()
  const custom = String(input.customModel || '').trim()
  return {
    enabled: input.enabled !== false,
    provider: normalizeProvider(input.provider || input.aiProvider),
    model: normalizeModel(custom || selected || DEFAULT_AI_MODEL),
    temperature: Number(clampNumber(input.temperature, 0, 5, DEFAULT_AI_TEMPERATURE).toFixed(2)),
    maxTokens: Math.round(clampNumber(input.maxTokens, 256, AI_MAX_TOKENS_CEILING, DEFAULT_AI_MAX_TOKENS)),
    externalBaseUrl: normalizeExternalBaseUrl(input.externalBaseUrl),
    externalModel: normalizeExternalModel(input.externalModel),
    externalTimeoutMs: Math.round(clampNumber(input.externalTimeoutMs, 5000, 60000, DEFAULT_AI_TIMEOUT_MS)),
    fallbackEnabled: input.fallbackEnabled === true,
    webSearchEnabled: input.webSearchEnabled === true,
  }
}

export async function getAiSettings(env: Pick<Bindings, 'DB'>, tenantId = 1): Promise<AiSettings> {
  const defaults = normalizeAiSettings({})
  try {
    const map = await SettingsStore.forTenant(env, tenantId).getMany([
      'ai_enabled', 'ai_provider', 'ai_model', 'ai_temperature', 'ai_max_tokens',
      'ai_external_base_url', 'ai_external_model', 'ai_external_timeout_ms', 'ai_fallback_enabled', 'ai_web_search_enabled',
    ])
    return normalizeAiSettings({
      enabled: map.ai_enabled === '' ? defaults.enabled : map.ai_enabled !== '0',
      aiProvider: map.ai_provider || defaults.provider,
      model: map.ai_model || defaults.model,
      temperature: Number(map.ai_temperature || defaults.temperature),
      maxTokens: Number(map.ai_max_tokens || defaults.maxTokens),
      externalBaseUrl: map.ai_external_base_url || '',
      externalModel: map.ai_external_model || '',
      externalTimeoutMs: Number(map.ai_external_timeout_ms || defaults.externalTimeoutMs),
      fallbackEnabled: map.ai_fallback_enabled === '1',
      webSearchEnabled: map.ai_web_search_enabled === '1',
    })
  } catch (e) {
    safeError('AI settings load failed, using defaults', e)
    return defaults
  }
}

export async function saveAiSettings(env: Pick<Bindings, 'DB'>, input: Partial<AiSettings>, tenantId = 1): Promise<AiSettings> {
  const settings = normalizeAiSettings(input)
  await SettingsStore.forTenant(env, tenantId).batch([
    ['ai_enabled', settings.enabled ? '1' : '0'],
    ['ai_provider', settings.provider],
    ['ai_model', settings.model],
    ['ai_temperature', String(settings.temperature)],
    ['ai_max_tokens', String(settings.maxTokens)],
    ['ai_external_base_url', settings.externalBaseUrl],
    ['ai_external_model', settings.externalModel],
    ['ai_external_timeout_ms', String(settings.externalTimeoutMs)],
    ['ai_fallback_enabled', settings.fallbackEnabled ? '1' : '0'],
    ['ai_web_search_enabled', settings.webSearchEnabled ? '1' : '0'],
  ])
  return settings
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function throwOnAiFailure(result: unknown, model: string): void {
  if (!result || typeof result !== 'object') return
  const value = result as any
  if (value.success === false || value.error || (Array.isArray(value.errors) && value.errors.length > 0)) {
    const detail = value.error || value.errors?.[0]?.message || value.errors?.[0] || value.message || '模型返回失败状态'
    throw new Error(`AI 调用失败（模型 ${model}）：${errorText(detail).slice(0, 600)}`)
  }
}

async function runWorkersAi(env: Pick<Bindings, 'AI'>, input: Record<string, unknown>, config: AiSettings): Promise<any> {
  if (!env.AI || typeof (env.AI as any).run !== 'function') {
    throw new Error('Workers AI binding “AI” 未在当前 Worker 运行环境生效，请检查生产环境 Binding 并重新部署。')
  }
  const payload = {
    ...input,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
  } as any
  const result = await env.AI.run(config.model, payload)
  throwOnAiFailure(result, config.model)
  return result
}

async function runOpenAiCompatible(env: Pick<Bindings, 'DB' | 'CACHE_KV' | 'JWT_SECRET' | 'EXTERNAL_AI_API_KEY'>, input: Record<string, unknown>, config: AiSettings): Promise<any> {
  const apiKey = await getSystemSecret(env, 'EXTERNAL_AI_API_KEY')
  if (!apiKey) throw new Error('外部 AI API Key 未配置。请进入后台「AI设置」填写；也可使用 Cloudflare Secret EXTERNAL_AI_API_KEY 作为兼容兜底。')
  if (!config.externalBaseUrl) throw new Error('外部 AI API 地址未配置或不是 HTTPS 公网地址。')
  if (!config.externalModel) throw new Error('外部 AI 模型名称未配置。')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.externalTimeoutMs)
  try {
    const messages = Array.isArray(input.messages)
      ? input.messages
      : [{ role: 'user', content: String(input.prompt || '') }]
    const payload = {
      model: config.externalModel,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    }

    const response = await fetch(config.externalBaseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const raw = await response.text()
    if (raw.length > 512 * 1024) throw new Error('外部 AI 响应过大，已拒绝解析。')
    let data: any = null
    try {
      data = raw ? JSON.parse(raw) : null
    } catch {
      data = { error: raw.slice(0, 800) }
    }
    if (!response.ok) {
      const detail = String(data?.error?.message || data?.error || data?.message || '').trim()
      throw new Error(`外部 AI API HTTP ${response.status}：${detail || '请求失败'}`)
    }
    if (!data || (!data.choices?.length && !data.response && !data.output_text && !data.text)) {
      throw new Error('外部 AI API 返回成功，但未找到可识别的模型文本。')
    }
    return data
  } catch (error) {
    if ((error as any)?.name === 'AbortError') throw new Error('外部 AI API 请求超时。')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export const DEFAULT_AI_DAILY_CALL_LIMIT = 0 // 0 = 不限制，由用户自行控制免费/付费额度

/** AI 日调用计数（可选：不强制限制，仅记录供参考） */
async function consumeDailyAiQuota(env: Pick<Bindings, 'CACHE_KV'>, limit: number): Promise<boolean> {
  if (!env.CACHE_KV || limit <= 0) return true // 不限制：直接放行
  const key = 'ai_daily_calls:' + new Date().toISOString().slice(0, 10)
  try {
    const current = Number((await env.CACHE_KV.get(key)) || '0')
    if (current >= limit) return false
    await env.CACHE_KV.put(key, String(current + 1), { expirationTtl: 2 * 86400 })
    return true
  } catch (e) {
    safeWarn('AI quota check failed; allowing call', { error: String(e) })
    return true
  }
}

export async function runConfiguredAi(
  env: Pick<Bindings, 'DB' | 'AI' | 'CACHE_KV' | 'JWT_SECRET' | 'EXTERNAL_AI_API_KEY'>,
  input: Record<string, unknown>,
  settings?: AiSettings,
): Promise<any | null> {
  const config = settings || await getAiSettings(env, 1)
  if (!config.enabled) return null
  if (!(await consumeDailyAiQuota(env, DEFAULT_AI_DAILY_CALL_LIMIT))) {
    safeWarn('AI 日调用上限已达,本次跳过模型调用,由调用方使用兜底内容')
    return null
  }

  const primary = config.provider === 'openai_compatible' ? 'external' : 'workers'
  const fallback = config.fallbackEnabled ? (primary === 'workers' ? 'external' : 'workers') : null
  const attempts = fallback ? [primary, fallback] : [primary]
  let lastError: unknown = null

  for (const provider of attempts) {
    try {
      if (provider === 'workers') return await runWorkersAi(env, input, config)
      return await runOpenAiCompatible(env, input, config)
    } catch (error) {
      lastError = error
      safeError('AI provider call failed', undefined, {
        provider,
        model: provider === 'workers' ? config.model : config.externalModel,
        fallbackEnabled: Boolean(fallback),
        message: errorText(error).slice(0, 400),
      })
      if (!fallback) throw error instanceof Error ? error : new Error(errorText(error))
    }
  }

  throw lastError instanceof Error ? lastError : new Error(errorText(lastError))
}
