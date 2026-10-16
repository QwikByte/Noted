import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { adminRevokeSessions } from '@/features/admin/server/admin'

/** Alle Sitzungen eines Benutzers beenden */
export const DELETE = route<{ id: string }>('admin', ({ user, ip, params }) => {
  adminRevokeSessions({ user, ip }, Number(params.id))
  return json({ ok: true })
})
