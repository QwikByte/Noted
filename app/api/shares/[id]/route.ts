import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { revokeShare } from '@/features/sharing/server/shares'

/** Link widerrufen */
export const DELETE = route<{ id: string }>('user', ({ user, ip, params }) => {
  revokeShare({ user, ip }, params.id)
  return json({ ok: true })
})
