import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { focusSessionSchema, listFocusSessions, saveFocusSessions } from '@/features/focus/server/sessions'

const schema = z.object({ sessions: z.array(focusSessionSchema).max(1000) })

/** Gezählte Runden des Fokus-Timers der letzten Monate */
export const GET = route('user', ({ user }) => json(listFocusSessions(user.id)))

/** Gezählte Runden übernehmen (auch nachträglich von offline gesammelten) */
export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema, 1024 * 1024)
  return json(saveFocusSessions(user.id, body.sessions))
})
