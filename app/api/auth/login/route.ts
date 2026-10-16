import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { setSessionCookie } from '@/features/auth/server/cookies'
import { login } from '@/features/auth/server/auth'
import { deleteSession, SESSION_COOKIE } from '@/features/auth/server/session'
import { sha256 } from '@/shared/server/crypto'

const schema = z.object({
  username: z.string().trim().min(1, 'Bitte gib deinen Benutzernamen ein.').max(64),
  password: z.string().min(1, 'Bitte gib dein Passwort ein.').max(512),
})

export const POST = route('none', async ({ req, ip }) => {
  const body = await parseJson(req, schema, 16 * 1024)
  const result = await login(body.username, body.password, { ip, userAgent: req.headers.get('user-agent') })

  // Eine evtl. noch vorhandene alte Sitzung dieses Browsers verwerfen
  const old = req.cookies.get(SESSION_COOKIE)?.value
  if (old) deleteSession(sha256(old))

  if (result.status === 'mfa') {
    const res = json({ status: 'mfa' as const })
    setSessionCookie(res, req, result.token, 'mfa')
    return res
  }
  const res = json({ status: 'ok' as const, setup: result.setup })
  setSessionCookie(res, req, result.token, 'full')
  return res
})
