import { z } from 'zod'
import { json, parseJson, route } from '@/lib/server/http'
import { confirmMfaSetup } from '@/lib/server/auth'

const schema = z.object({ code: z.string().trim().min(1, 'Bitte gib den Code ein.').max(20) })

export const POST = route('setup', async ({ req, user, session, ip }) => {
  const { code } = await parseJson(req, schema)
  confirmMfaSetup(user, session, code, ip)
  return json({ ok: true })
})
