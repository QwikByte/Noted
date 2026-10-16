import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { clearSessionCookie } from '@/features/auth/server/cookies'
import { deleteSession, getSession, SESSION_COOKIE } from '@/features/auth/server/session'
import { audit } from '@/shared/server/audit'

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
