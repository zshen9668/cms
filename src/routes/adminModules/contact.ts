import { Hono } from 'hono'
import type { Bindings } from '../../types'
import { getContactAdmin, updateContactAdmin } from '../../modules/adminManagers/contactAdmin'

export const contactAdminRoutes = new Hono<{ Bindings: Bindings }>()

contactAdminRoutes.get('/', async (c) => {
  const data = await getContactAdmin(c.env)
  return c.json({ ok: true, data })
})

contactAdminRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  await updateContactAdmin(c.env, body)
  return c.json({ ok: true })
})
