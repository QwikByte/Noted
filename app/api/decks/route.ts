import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { createDeck, deckSchema } from '@/features/flashcards/server/flashcards'

export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, deckSchema)
  return json({ deck: createDeck(user.id, body) }, { status: 201 })
})
