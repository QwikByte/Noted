import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { optimizeFsrsParams, resetFsrsParams } from '@/features/flashcards/server/fsrs-params'

const schema = z.object({ timeZone: z.string().min(1).max(100) })

/** FSRS-Gewichte aus dem eigenen Lernverlauf schätzen – `timeZone`: Zeitzone des Geräts für die Einteilung in Tage */
export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema)
  return json(await optimizeFsrsParams(user.id, body.timeZone))
})

/** Zurück zu den Standardwerten */
export const DELETE = route('user', ({ user }) => json({ fsrs: resetFsrsParams(user.id) }))
