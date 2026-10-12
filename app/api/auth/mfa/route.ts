import { z } from 'zod'
import { json, parseJson, route, setSessionCookie } from '@/lib/server/http'
import { completeMfaLogin } from '@/lib/server/auth'

const schema = z.object({
  code: z.string().trim().min(1, 'Bitte gib den Code ein.').max(20),
})

export const POST = route('mfa', async ({ req, session, user, ip }) => {
  const { code } = await parseJson(req, schema, 4 * 1024)
  const result = await completeMfaLogin(session, user, code, { ip, userAgent: req.headers.get('user-agent') })
  const res = json({ status: 'ok' as const, setup: result.setup })
  setSessionCookie(res, req, result.token, 'full')
  return res
})
