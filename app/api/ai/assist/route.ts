import { parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { assist } from '@/features/ai/server/assist'
import { MAX_AI_REQUEST_BYTES, assistRequestSchema } from '@/features/ai/schemas'

/** KI-Assistent: Text ändern oder eine Frage beantworten – die Antwort kommt Stück für Stück (eine JSON-Zeile je Teil) */
export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, assistRequestSchema, MAX_AI_REQUEST_BYTES)
  const stream = await assist(user.id, body, req.signal)
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } })
})
