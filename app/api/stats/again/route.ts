import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { againToday } from '@/features/flashcards/server/stats'

/** Heute mit „Nochmal“ bewertete Kartenseiten – `?tz=Europe/Berlin`: Zeitzone des Geräts für „heute“ */
export const GET = route('user', ({ req, user }) => {
  const tz = (req.nextUrl.searchParams.get('tz') ?? 'UTC').slice(0, 100)
  return json({ sides: againToday(user.id, tz) })
})
