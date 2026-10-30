import type { CmsPlugin } from '../types'
import type { Bindings } from '../../types'
import { SettingsStore } from '../../utils/settingsStore'
import { safeWarn } from '../../utils/safeLogger'

export type TurnstileResult = { valid: boolean; skipped?: boolean }

/**
 * Turnstile 人机校验(移植 SonicJS turnstile-plugin,零依赖走 fetch)。
 * - 密钥存 settings:turnstile_site_key / turnstile_secret_key(管理端系统设置维护,免重部署)
 * - 未配置 secret 时返回 skipped,调用方按放行处理(开发态)
 * - 生产建议:登录/表单/contact 关键写端点接入;校验失败 → 403
 */
export async function verifyTurnstile(env: Bindings, tenantId: number, token: string, remoteIp?: string): Promise<TurnstileResult> {
  const settings = await SettingsStore.forTenant(env, tenantId).getMany(['turnstile_site_key', 'turnstile_secret_key'])
  const secretKey = String(settings['turnstile_secret_key'] || '').trim()
  if (!secretKey) return { valid: true, skipped: true }
  if (!token.trim()) return { valid: false }
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: secretKey, response: token, remoteip: remoteIp }),
      signal: AbortSignal.timeout(5000),
    })
    const data = (await res.json()) as { success?: boolean }
    return { valid: data.success === true }
  } catch (e) {
    // 校验服务不可用时降级为跳过(与无 secret 行为一致),避免误伤
    safeWarn('turnstile verify unavailable, skipping', { error: String(e) })
    return { valid: true, skipped: true }
  }
}

export async function turnstileSiteKey(env: Bindings): Promise<string> {
  return String(await SettingsStore.for(env).get('turnstile_site_key') || '')
}

export const turnstilePlugin: CmsPlugin = {
  id: 'turnstile',
  version: '1.0.0',
  mount() {
    // 无路由:作为工具服务由登录/contact/表单写端点调用 verifyTurnstile
  },
}
