import { z } from 'zod'
import { json, parseJson, route } from '@/lib/server/http'
import { cardSchema, createCards } from '@/lib/server/flashcards'

const schema = z.object({ cards: z.array(cardSchema).min(1).max(2000) })

/** Eine oder mehrere Karten anlegen */
export const POST = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, schema, 20 * 1024 * 1024)
  return json({ cards: createCards(user.id, params.id, body.cards) }, { status: 201 })
})
