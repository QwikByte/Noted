import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { saveSubmittedReviews } from '@/features/flashcards/server/flashcards'

// Die Einträge prüft saveSubmittedReviews einzeln – ein ungültiger soll nicht alle anderen mitreißen
const schema = z.object({
  reviews: z.array(z.unknown()).max(5000),
  log: z.array(z.unknown()).max(5000).optional(),
  undo: z.array(z.unknown()).max(5000).optional(),
})

/**
 * Bewertungen aus Lernsitzungen übernehmen (auch nachträglich von offline gesammelten) – samt Protokoll und
 * zurückgenommenen Bewertungen
 */
export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema, 10 * 1024 * 1024)
  return json(saveSubmittedReviews(user.id, body.reviews, body.log, body.undo))
})
