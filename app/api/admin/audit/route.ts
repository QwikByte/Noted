import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { listAudit } from '@/shared/server/audit'

const MAX_LIMIT = 500
const DEFAULT_LIMIT = 100

/** Positive ganze Zahl aus der Query – alles andere (leer, Text, 0, negativ) zählt als nicht angegeben */
function positiveInt(value: string | null): number | undefined {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n >= 1 ? n : undefined
}

export const GET = route('admin', ({ req }) => {
  const before = positiveInt(req.nextUrl.searchParams.get('before'))
  // Ohne Obergrenze würde z. B. „limit=-1“ in SQLite als „kein Limit“ gelten
  const limit = Math.min(MAX_LIMIT, positiveInt(req.nextUrl.searchParams.get('limit')) ?? DEFAULT_LIMIT)
  return json({ entries: listAudit(limit, before) })
})
