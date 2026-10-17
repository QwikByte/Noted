import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { reviewLogSchema, reviewSchema, saveReviews } from '@/features/flashcards/server/flashcards'

const schema = z.object({ reviews: z.array(reviewSchema).max(5000), log: z.array(reviewLogSchema).max(5000).optional() })

/** Bewertungen aus Lernsitzungen übernehmen (auch nachträglich von offline gesammelten) – samt Protokoll */
export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema, 10 * 1024 * 1024)
  return json(saveReviews(user.id, body.reviews, body.log))
})
