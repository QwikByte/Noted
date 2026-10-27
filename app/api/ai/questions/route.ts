import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { generateQuestions } from '@/features/ai/server/questions'
import { MAX_AI_REQUEST_BYTES, questionsRequestSchema } from '@/features/ai/schemas'

/** Verständnisfragen zu einer Notiz bzw. Aufgaben einer Probeklausur aus Stapeln von Claude stellen lassen */
export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, questionsRequestSchema, MAX_AI_REQUEST_BYTES)
  return json(await generateQuestions(user.id, body, req.signal))
})
