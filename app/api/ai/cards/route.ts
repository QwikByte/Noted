import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { suggestCards } from '@/features/ai/server/cards'
import { MAX_AI_REQUEST_BYTES, cardsRequestSchema } from '@/features/ai/schemas'

/**
 * Karteikarten von Claude vorschlagen lassen – aus einer Notiz, PDF-Seiten oder -Markierungen bzw. als Überarbeitung
 * einer Karte. Gespeichert wird erst, was man in der Oberfläche übernimmt.
 */
export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, cardsRequestSchema, MAX_AI_REQUEST_BYTES)
  return json({ cards: await suggestCards(user.id, body, req.signal) })
})
