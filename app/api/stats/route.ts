import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getStudyStats } from '@/features/flashcards/server/stats'

/** Lernstatistik – `?tz=Europe/Berlin`: Zeitzone des Geräts für die Einteilung in Tage */
export const GET = route('user', ({ req, user }) => {
  const tz = (req.nextUrl.searchParams.get('tz') ?? 'UTC').slice(0, 100)
  return json(getStudyStats(user.id, tz))
})
