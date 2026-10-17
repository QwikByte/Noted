import { route } from '@/features/auth/server/route'
import { exportIcs } from '@/features/calendar/server/events'

/** Alle Termine als .ics – für andere Kalender-Apps */
export const GET = route('user', ({ user }) => {
  return new Response(exportIcs(user.id), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="Kalender.ics"',
    },
  })
})
