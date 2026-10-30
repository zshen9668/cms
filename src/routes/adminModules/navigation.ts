import { Hono } from 'hono'
import type { Bindings } from '../../types'
import { getNavigationAdmin, updateNavigationAdmin } from '../../modules/adminManagers/navigationAdmin'

export const navigationAdminRoutes = new Hono<{ Bindings: Bindings }>()

navigationAdminRoutes.get('/', async (c) => {
  const data = await getNavigationAdmin(c.env)
  return c.json({ ok: true, data })
})

navigationAdminRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  await updateNavigationAdmin(c.env, body)
  return c.json({ ok: true })
})
