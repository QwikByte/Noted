import { json, route } from '@/lib/server/http'
import { adminRevokeSessions } from '@/lib/server/admin'

/** Alle Sitzungen eines Benutzers beenden */
export const DELETE = route<{ id: string }>('admin', ({ user, ip, params }) => {
  adminRevokeSessions({ user, ip }, Number(params.id))
  return json({ ok: true })
})
