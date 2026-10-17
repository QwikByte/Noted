import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { changeOccurrence, occurrenceSchema } from '@/features/calendar/server/events'

/** Nur einen Termin einer Serie ändern (event) oder ausfallen lassen (event: null) */
export const POST = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, occurrenceSchema, 256 * 1024)
  return json(changeOccurrence(user.id, params.id, body.date, body.event))
})
