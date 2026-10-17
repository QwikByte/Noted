import { route } from '@/features/auth/server/route'
import { reviewLogCsv } from '@/features/flashcards/server/stats'

/** Bewertungsprotokoll als CSV herunterladen */
export const GET = route('user', ({ user }) => {
  const filename = `Bewertungsprotokoll ${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(reviewLogCsv(user.id), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
})
