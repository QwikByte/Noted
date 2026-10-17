import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { createEvent, eventSchema, listEvents } from '@/features/calendar/server/events'

/** Alle Termine – die Vorkommen von Serien berechnet der Browser (auch offline) */
export const GET = route('user', ({ user }) => json({ events: listEvents(user.id) }))

export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, eventSchema, 256 * 1024)
  return json({ event: createEvent(user.id, body) }, { status: 201 })
})
