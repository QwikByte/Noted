import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { deleteEvent, eventSchema, updateEvent } from '@/features/calendar/server/events'

/** Termin bzw. ganze Serie ändern */
export const PUT = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, eventSchema, 256 * 1024)
  return json({ event: updateEvent(user.id, params.id, body) })
})

/** Termin bzw. ganze Serie löschen */
export const DELETE = route<{ id: string }>('user', ({ user, params }) => {
  deleteEvent(user.id, params.id)
  return json({ ok: true })
})
