import { clearSessionCookie, json, route } from '@/lib/server/http'
import { deleteSession, getSession, SESSION_COOKIE } from '@/lib/server/session'
import { audit } from '@/lib/server/audit'

export const POST = route('none', async ({ req, ip }) => {
  const found = getSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (found) {
    deleteSession(found.session.id)
    if (found.session.stage === 'full') {
      audit({ event: 'logout', userId: found.user.id, username: found.user.username, ip })
    }
  }
  const res = json({ ok: true })
  clearSessionCookie(res, req)
  return res
})
