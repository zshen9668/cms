import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { SYSTEM_SECRET_SPECS, saveSystemSecret, buildSystemSecretForm } from '../../utils/systemSecrets'
import { resolveAdminSiteName } from '../../utils/adminSiteName'
import { renderSystemSecretsPage } from '../../templates/adminSystemSecrets'
import { getTenantId } from '../../db/scoped'
import { safeError } from '../../utils/safeLogger'
import { errorMessage } from '../../utils/errors'

/**
 * 「系统密钥」后台路由。
 *
 * 站长在这里填写所有运行时密钥，无需预先在 Cloudflare 配置 Secret。
 * 密钥经 AES-GCM 加密后存进 D1 settings 表（实现见 utils/protectedSecrets.ts）。
 *
 * 安全约束：
 * - 只接受 systemSecrets.ts 注册表里登记过的密钥名，未登记的一律拒绝，防止任意 key 写库。
 * - 表单只提交当前分组的字段，服务端按 group 过滤，避免越组写入。
 * - 明文密钥永不回显，页面只显示「已配置 / 未配置」。
 */
export const adminSystemSecretRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

adminSystemSecretRoutes.get('/system-secrets', async (c) => {
  const groups = await buildSystemSecretForm(c.env)
  const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
  return c.html(
    renderSystemSecretsPage(groups, {
      saved: c.req.query('saved') || '',
      cleared: c.req.query('cleared') || '',
      error: c.req.query('error') || '',
      siteName,
    }),
  )
})

adminSystemSecretRoutes.post('/system-secrets', async (c) => {
  const body = await c.req.parseBody()
  const group = String(body.group || '').trim()
  const specs = SYSTEM_SECRET_SPECS.filter((spec) => spec.group === group)
  if (!specs.length) {
    return c.redirect('/admin/system-secrets?error=' + encodeURIComponent('未知的密钥分组，请从页面上重新提交。'))
  }

  const errors: string[] = []
  const clearedLabels: string[] = []
  let sessionsInvalidated = false
  let savedCount = 0

  try {
    for (const spec of specs) {
      // 清除优先于填写，避免用户同时勾选清除又粘贴了新值时产生歧义
      if (String(body['clear_' + spec.name] || '') === 'on') {
        await saveSystemSecret(c.env, spec.name, '')
        clearedLabels.push(spec.label)
        if (spec.invalidatesSessions) sessionsInvalidated = true
        continue
      }

      const raw = String(body[spec.name] ?? '').trim()
      if (!raw) continue

      const invalid = validateSecretValue(spec.name, raw)
      if (invalid) {
        errors.push(invalid)
        continue
      }

      await saveSystemSecret(c.env, spec.name, raw)
      savedCount++
      if (spec.invalidatesSessions) sessionsInvalidated = true
    }
  } catch (e) {
    safeError('save system secrets failed', e, { group })
    return c.redirect('/admin/system-secrets?error=' + encodeURIComponent(errorMessage(e, '保存密钥失败')))
  }

  if (errors.length) {
    return c.redirect('/admin/system-secrets?error=' + encodeURIComponent(errors.join('；')))
  }
  if (clearedLabels.length && !savedCount) {
    return c.redirect('/admin/system-secrets?cleared=' + encodeURIComponent(clearedLabels.join('、')))
  }
  const suffix = sessionsInvalidated ? '&error=' + encodeURIComponent('登录签名密钥已更新，所有后台会话已失效，请重新登录。') : ''
  return c.redirect('/admin/system-secrets?saved=' + encodeURIComponent(group) + suffix)
})

/**
 * 逐项格式校验。只拦「一定填错了」的输入，不做过度限制，
 * 避免测试密钥、自定义 Token 被误拒。返回 null 表示通过。
 */
function validateSecretValue(name: string, value: string): string | null {
  switch (name) {
    case 'JWT_SECRET':
      return value.length >= 16 ? null : '登录会话签名密钥至少 16 位（建议 32 位以上随机字符串）'
    case 'SETUP_TOKEN':
      return value.length >= 6 ? null : '后台初始化令牌至少 6 位'
    case 'GOOGLE_SERVICE_ACCOUNT_JSON': {
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>
        if (!parsed || typeof parsed !== 'object') return 'Google 服务账号 JSON 格式不正确，请粘贴完整内容'
        if (String(parsed.type || '') !== 'service_account') return 'Google 服务账号 JSON 缺少 type=service_account，请确认下载的是服务账号密钥文件'
        if (!parsed.client_email || !parsed.private_key) return 'Google 服务账号 JSON 缺少 client_email 或 private_key'
        return null
      } catch {
        return 'Google 服务账号 JSON 解析失败，请粘贴完整内容（含首尾大括号）'
      }
    }
    case 'WECHAT_WORK_AES_KEY':
      return value.length === 43 ? null : '企业微信 EncodingAESKey 必须是 43 位'
    case 'WECHAT_WORK_AGENT_ID':
      return /^\d+$/.test(value) ? null : '企业微信 AgentId 必须是纯数字'
    default:
      return null
  }
}
