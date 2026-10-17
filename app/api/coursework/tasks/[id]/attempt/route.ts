import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { attemptSchema, recordAttempt } from '@/features/coursework/server/coursework'

/** Aufgabe bearbeitet: gelöst, unsicher oder falsch – danach plant der Server die nächste Wiederholung */
export const POST = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, attemptSchema, 1024)
  return json({ task: recordAttempt(user.id, params.id, body.result, body.today) })
})
