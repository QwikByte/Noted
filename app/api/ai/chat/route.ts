import { parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { chat } from '@/features/ai/server/chat'
import { MAX_AI_REQUEST_BYTES, chatRequestSchema } from '@/features/ai/schemas'

/**
 * KI-Chat: Claude antwortet und liest dafür bei Bedarf Notizen, Dateien, Karteikarten, Lernstand und Termine – die
 * Antwort kommt Stück für Stück (eine JSON-Zeile je Teil), am Ende mit den neuen Einträgen für den Verlauf
 */
export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, chatRequestSchema, MAX_AI_REQUEST_BYTES)
  const stream = await chat(user.id, body, req.signal)
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } })
})
