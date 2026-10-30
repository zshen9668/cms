import { Hono } from 'hono'
import type { CmsPlugin } from '../types'
import type { Bindings, Variables } from '../../types'
import { safeError } from '../../utils/safeLogger'
import { getTenantId } from '../../db/scoped'
import { createApiKey, authenticateBearer, revokeApiKey, listApiKeys } from './service'
import { renderApiKeyPage, renderApiKeyCreatedPage } from '../../templates/adminApiKeys'
import { resolveAdminSiteName } from '../../utils/adminSiteName'

/**
 * API 密钥插件(移植 SonicJS api-keys-plugin:Bearer 认证的公开只读密钥)。
 * - 管理端:/admin/api-keys(HTML 列表 + 创建 + 吊销;完整密钥只在创建响应出现一次)
 * - 鉴权助手:requireApiKey(c, scope) 读 Authorization: Bearer,供 /api/v2 读端点挂门
 * - 多租户:所有密钥操作按当前请求租户(getTenantId)隔离,不硬编码租户 1
 */
const routes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

routes.get('/api-keys', async (c) => {
  try {
    const keys = await listApiKeys(c.env, getTenantId(c))
    const siteName = await resolveAdminSiteName(c.env, getTenantId(c))
    const cspNonce = (c as any).get('cspNonce') || ''
    const csrfToken = (c as any).get('csrfToken') || ''
    return c.html(renderApiKeyPage(keys, siteName, cspNonce, csrfToken))
  } catch (e) {
    safeError('api keys page failed', e)
    return c.redirect('/admin/api-keys?error=' + encodeURIComponent('密钥列表加载失败'))
  }
})

routes.post('/api-keys/create', async (c) => {
  try {
    const body = (await c.req.parseBody()) as Record<string, string | File>
    const name = String(body.name || '').trim().slice(0, 80)
    if (!name) return c.redirect('/admin/api-keys?error=' + encodeURIComponent('名称必填'))

    // 权限范围:当前仅开放 read;write 待 RBAC 阶段随权限体系一起开放
    const scopes = 'read'

    // 过期时间:datetime-local 输入 "YYYY-MM-DDTHH:mm",补 ":00" 与 D1 datetime('now') 格式对齐
    let expiresAt: string | null = null
    const rawExp = String(body.expires_at || '').trim()
    if (rawExp) {
      expiresAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rawExp) ? rawExp + ':00' : rawExp
    }

    // 完整密钥只在这一刻返回;页面渲染后库内只剩哈希,无法再取回
    const { fullKey, key } = await createApiKey(c.env, getTenantId(c), name, scopes, expiresAt)
    return c.html(renderApiKeyCreatedPage(fullKey, key))
  } catch (e: any) {
    safeError('create api key failed', e)
    return c.redirect('/admin/api-keys?error=' + encodeURIComponent(String(e?.message || e || '创建失败')))
  }
})

routes.post('/api-keys/:id/revoke', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) {
      return c.redirect('/admin/api-keys?error=' + encodeURIComponent('无效的密钥 id'))
    }
    // 按当前租户吊销,防止跨租户删除他人密钥
    await revokeApiKey(c.env, id, getTenantId(c))
    return c.redirect('/admin/api-keys?ok=' + encodeURIComponent('密钥已吊销'))
  } catch (e) {
    safeError('revoke api key failed', e)
    return c.redirect('/admin/api-keys?error=' + encodeURIComponent('吊销失败'))
  }
})

export const apiKeysPlugin: CmsPlugin = {
  id: 'api-keys',
  version: '1.0.0',
  mount(app) {
    // 挂在 /admin 命名空间下;admin.ts 已对 requireAdmin 全局拦截
    app.route('/admin', routes)
  },
}

/**
 * Bearer 鉴权助手:读 Authorization 头,校验密钥并按 scope 放行/拒绝。
 * 已挂到 /api/v2 读端点(见 src/routes/apiV2.ts):在路由前调用,不 ok 则 401。
 */
export async function requireApiKey(c: {
  req: { header: (name: string) => string | undefined }
  env: Bindings
}, requiredScope: string, tenantId: number = 1): Promise<{ ok: boolean; scope?: string; keyId?: number }> {
  const header = c.req.header('authorization') || ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false }

  const res = await authenticateBearer(c.env, token, tenantId)
  if (!res.ok) return res
  if (!String(res.scope).split(',').includes(requiredScope)) return { ok: false }
  return res
}
