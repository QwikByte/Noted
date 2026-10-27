import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { gradeAnswers } from '@/features/ai/server/grade'
import { MAX_AI_REQUEST_BYTES, gradeRequestSchema } from '@/features/ai/schemas'

/** Antworten von Claude bewerten lassen – beim Lernen, beim Tutor und in der Probeklausur (auch mit Fotos) */
export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, gradeRequestSchema, MAX_AI_REQUEST_BYTES)
  return json({ results: await gradeAnswers(user.id, body, req.signal) })
})
