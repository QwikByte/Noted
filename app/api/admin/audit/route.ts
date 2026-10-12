import { json, route } from '@/lib/server/http'
import { listAudit } from '@/lib/server/audit'

export const GET = route('admin', ({ req }) => {
  const before = Number(req.nextUrl.searchParams.get('before')) || undefined
  const limit = Math.min(500, Number(req.nextUrl.searchParams.get('limit')) || 100)
  return json({ entries: listAudit(limit, before) })
})
