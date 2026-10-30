import { Hono } from 'hono'
import type { Bindings, Variables } from '../../types'
import { getCurrentAdmin, getTenantId } from './shared'
import { safeError } from '../../utils/safeLogger'
import { renderMessagesList } from '../../templates/admin'
import { errorMessage } from '../../utils/errors'
import { resolveAdminSiteName } from '../../utils/adminSiteName'

export const adminMessagesRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

adminMessagesRoutes.get('/messages', async (c) => {
  const tenantId = getTenantId(c)
  const siteName = await resolveAdminSiteName(c.env, tenantId)
  const cspNonce = (c as any).get("csrfToken") || ""
  const csrfToken = (c as any).get("csrfToken") || ""
  const statusFilter = c.req.query('status')
  const where = statusFilter ? 'WHERE m.status = ? AND m.tenant_id = ?' : 'WHERE m.tenant_id = ?'
  const stmt = c.env.DB.prepare(
    `SELECT m.*, (SELECT COUNT(*) FROM message_replies r WHERE r.message_id=m.id) AS reply_count FROM messages m ${where} ORDER BY m.created_at DESC LIMIT 200`
  )
  const rows = (statusFilter ? await stmt.bind(statusFilter, tenantId).all() : await stmt.bind(tenantId).all()).results as any[]
  if (rows.length) {
    const ids = rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0)
    if (ids.length) {
      const byMessage = new Map<number, any[]>()
      for (let i = 0; i < ids.length; i += 90) {
        const part = ids.slice(i, i + 90)
        const marks = part.map(() => '?').join(',')
        const replyRows = (await c.env.DB.prepare(`SELECT id, message_id, content, channel, operator, created_at FROM message_replies WHERE message_id IN (${marks}) ORDER BY created_at ASC, id ASC`).bind(...part).all()).results as any[]
        for (const reply of replyRows) {
          const key = Number(reply.message_id)
          const list = byMessage.get(key) || []
          if (list.length < 30) list.push(reply)
          byMessage.set(key, list)
        }
      }
      for (const row of rows) row.replies = byMessage.get(Number(row.id)) || []
    }
  }
  const message = c.req.query('error') || (c.req.query('replied') === '1' ? '回复已保存，并已将该留言标记为“已回复”。' : '')
  return c.html(renderMessagesList(rows, statusFilter, message, siteName, cspNonce, csrfToken))
})

adminMessagesRoutes.post('/messages/:id/read', async (c) => {
  await c.env.DB.prepare("UPDATE messages SET status='read' WHERE id=? AND tenant_id=? AND status='new'").bind(c.req.param('id'), getTenantId(c)).run()
  return c.redirect('/admin/messages')
})

adminMessagesRoutes.post('/messages/:id/reply', async (c) => {
  const id = Number(c.req.param('id'))
  const tenantId = getTenantId(c)
  if (!id) return c.notFound()
  const message = await c.env.DB.prepare('SELECT id, email, name FROM messages WHERE id=? AND tenant_id=? LIMIT 1').bind(id, tenantId).first()
  if (!message) return c.notFound()
  const body = await c.req.parseBody()
  const content = String(body.content || '').trim().slice(0, 3000)
  // 回复渠道只记录「用什么方式回复的」，不再真的发邮件：
  // 邮件发送功能已整体移除（见 CHANGELOG），留言回复统一走站内记录 + 人工联系。
  const allowedChannels = new Set(['电话', '微信', 'QQ', '其他', '内部记录'])
  const requestedChannel = String(body.channel || '')
  const channel = allowedChannels.has(requestedChannel) ? requestedChannel : '内部记录'
  if (!content) return c.redirect('/admin/messages?error=' + encodeURIComponent('回复内容不能为空'))
  const admin = await getCurrentAdmin(c)
  const operator = String(admin?.email || '管理员').slice(0, 200)
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO message_replies (message_id, content, channel, operator) VALUES (?, ?, ?, ?)').bind(id, content, channel, operator),
      c.env.DB.prepare("UPDATE messages SET status='replied' WHERE id=?").bind(id),
    ])
  } catch (e) { safeError('save customer message reply failed', e); return c.redirect('/admin/messages?error=' + encodeURIComponent('回复保存失败，请确认已完成数据库迁移：' + errorMessage(e, '未知错误'))) }
  return c.redirect('/admin/messages?replied=1')
})

adminMessagesRoutes.post('/messages/:id/delete', async (c) => {
  const id = Number(c.req.param('id'))
  const tenantId = getTenantId(c)
  if (!id) return c.notFound()
  try { await c.env.DB.prepare('DELETE FROM message_replies WHERE message_id=? AND tenant_id=?').bind(id, tenantId).run(); await c.env.DB.prepare('DELETE FROM messages WHERE id=? AND tenant_id=?').bind(id, tenantId).run() } catch (e) { safeError('delete customer message failed', e); return c.text('删除留言失败', 500) }
  return c.redirect('/admin/messages')
})
