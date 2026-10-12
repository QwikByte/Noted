import { json, route } from '@/lib/server/http'
import { deleteUserSessions, listUserSessions } from '@/lib/server/session'
import { audit } from '@/lib/server/audit'

export const GET = route('setup', ({ user, session }) => {
  return json({ sessions: listUserSessions(user.id, session.id) })
})

/** Alle anderen Sitzungen abmelden */
export const DELETE = route('setup', ({ user, session, ip }) => {
  deleteUserSessions(user.id, session.id)
  audit({ event: 'session_revoked', userId: user.id, username: user.username, actorId: user.id, ip, details: { all: true } })
  return json({ ok: true })
})
