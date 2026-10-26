import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { batchCards } from '@/features/flashcards/server/flashcards'
import { MAX_BATCH_CARDS } from '@/features/flashcards/limits'

const schema = z.object({
  action: z.enum(['move', 'suspend', 'resume', 'reset', 'delete']),
  ids: z
    .array(z.string().uuid())
    .min(1, 'Wähle mindestens eine Karte aus.')
    .max(MAX_BATCH_CARDS, `Höchstens ${MAX_BATCH_CARDS.toLocaleString('de-DE')} Karten auf einmal.`),
  deckId: z.string().uuid().optional(),
})

/** Mehrere Karten verschieben, aussetzen, fortsetzen, neu lernen oder löschen (Kartenbrowser) */
export const POST = route('user', async ({ req, user }) => {
  const { action, ids, deckId } = await parseJson(req, schema)
  return json(batchCards(user.id, action, ids, deckId))
})
