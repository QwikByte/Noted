import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { deleteUserSessions, listUserSessions } from '@/features/auth/server/session'
import { audit } from '@/shared/server/audit'

export const GET = route('setup', ({ user, session }) => {
  return json({ sessions: listUserSessions(user.id, session.id) })
})

/** Alle anderen Sitzungen abmelden */
export const DELETE = route('setup', ({ user, session, ip }) => {
  deleteUserSessions(user.id, session.id)
  audit({ event: 'session_revoked', userId: user.id, username: user.username, actorId: user.id, ip, details: { all: true } })
  return json({ ok: true })
})
