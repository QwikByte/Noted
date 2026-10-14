import { json, parseJson, route } from '@/lib/server/http'
import { createDeck, deckSchema } from '@/lib/server/flashcards'

export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, deckSchema)
  return json({ deck: createDeck(user.id, body) }, { status: 201 })
})
