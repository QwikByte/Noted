import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { setDayStartHour } from '@/features/flashcards/server/settings'

const schema = z.object({
  dayStartHour: z.number().int().min(0, 'Der Tag beginnt zwischen 0 und 23 Uhr.').max(23, 'Der Tag beginnt zwischen 0 und 23 Uhr.'),
})

/** Einstellungen der Karteikarten für alle Stapel des Kontos – bisher der Beginn des Lerntags */
export const PATCH = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema)
  return json({ dayStartHour: setDayStartHour(user.id, body.dayStartHour) })
})
