import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { listAudit } from '@/shared/server/audit'

export const GET = route('admin', ({ req }) => {
  const before = Number(req.nextUrl.searchParams.get('before')) || undefined
  const limit = Math.min(500, Number(req.nextUrl.searchParams.get('limit')) || 100)
  return json({ entries: listAudit(limit, before) })
})
