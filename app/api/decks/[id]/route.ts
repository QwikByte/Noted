import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { deckSchema, deleteDeck, updateDeck } from '@/features/flashcards/server/flashcards'

export const PATCH = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, deckSchema.partial())
  return json({ deck: updateDeck(user.id, params.id, body) })
})

/** Stapel mit allen Karten löschen */
export const DELETE = route<{ id: string }>('user', ({ user, params }) => json(deleteDeck(user.id, params.id)))
