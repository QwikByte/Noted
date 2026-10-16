import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { cardSchema, deleteCard, updateCard } from '@/features/flashcards/server/flashcards'

const schema = cardSchema.partial().extend({ deckId: z.string().uuid().optional() })

export const PATCH = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, schema)
  return json({ card: updateCard(user.id, params.id, body) })
})

export const DELETE = route<{ id: string }>('user', ({ user, params }) => {
  deleteCard(user.id, params.id)
  return json({ ok: true })
})
