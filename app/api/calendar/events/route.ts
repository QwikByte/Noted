import { z } from 'zod'
import { badRequest, json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { listEvents } from '@/features/calendar/server/calendar'

const query = z.object({ start: z.string().max(40), end: z.string().max(40) })

/** Termine der gewählten Kalender zwischen start und end (ISO-Zeitpunkte) */
export const GET = route('user', async ({ req, user }) => {
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) throw badRequest('Ungültiger Zeitraum.')
  return json({ events: await listEvents(user.id, parsed.data.start, parsed.data.end) })
})
