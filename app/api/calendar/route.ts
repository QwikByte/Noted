import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { calendarStatus, disconnect, setCalendars } from '@/features/calendar/server/calendar'

/** Ist ein Kalender verbunden, mit welchem Konto, welche Kalender gibt es? */
export const GET = route('user', async ({ user }) => json(await calendarStatus(user.id)))

const schema = z.object({ calendars: z.array(z.string().min(1).max(1000)).max(50) })

/** Auswahl der Kalender für das Dashboard */
export const PUT = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema, 64 * 1024)
  setCalendars(user.id, body.calendars)
  return json(await calendarStatus(user.id))
})

/** Verbindung trennen – die gespeicherten Zugangsdaten werden gelöscht */
export const DELETE = route('user', ({ user, ip }) => {
  disconnect(user, ip)
  return json({ ok: true })
})
