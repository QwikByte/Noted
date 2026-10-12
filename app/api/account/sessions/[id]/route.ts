import { json, notFound, route } from '@/lib/server/http'
import { deleteUserSessionByPrefix } from '@/lib/server/session'
import { audit } from '@/lib/server/audit'

export const DELETE = route<{ id: string }>('setup', ({ user, params, ip }) => {
  if (!deleteUserSessionByPrefix(user.id, params.id)) throw notFound('Sitzung nicht gefunden.')
  audit({ event: 'session_revoked', userId: user.id, username: user.username, actorId: user.id, ip })
  return json({ ok: true })
})
