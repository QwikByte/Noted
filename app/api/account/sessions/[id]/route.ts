import { json, notFound } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { deleteUserSessionByPrefix } from '@/features/auth/server/session'
import { audit } from '@/shared/server/audit'

export const DELETE = route<{ id: string }>('setup', ({ user, params, ip }) => {
  if (!deleteUserSessionByPrefix(user.id, params.id)) throw notFound('Sitzung nicht gefunden.')
  audit({ event: 'session_revoked', userId: user.id, username: user.username, actorId: user.id, ip })
  return json({ ok: true })
})
