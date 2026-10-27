import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { suggestCards } from '@/features/ai/server/cards'
import { MAX_AI_EXISTING, MAX_AI_NOTE_CHARS, MAX_AI_WISHES } from '@/features/ai/limits'
import { MAX_CARD_TEXT } from '@/features/flashcards/limits'

const schema = z.object({
  noteId: z.string().min(1).max(100),
  title: z.string().max(1000),
  content: z
    .string()
    .max(MAX_AI_NOTE_CHARS, `Die Notiz ist für Claude zu lang (höchstens ${MAX_AI_NOTE_CHARS.toLocaleString('de-DE')} Zeichen).`),
  existing: z.array(z.string().max(MAX_CARD_TEXT)).max(MAX_AI_EXISTING).optional(),
  wishes: z.string().max(MAX_AI_WISHES, 'Die Wünsche sind zu lang.').optional(),
})

/** Karteikarten aus einer Notiz von Claude vorschlagen lassen – gespeichert wird erst, was man im Dialog übernimmt */
export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema, 8 * 1024 * 1024)
  return json({ cards: await suggestCards(user.id, body, req.signal) })
})
