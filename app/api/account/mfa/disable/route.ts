import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { disableMfa } from '@/features/auth/server/auth'

const schema = z.object({
  password: z.string().min(1, 'Bitte gib dein Passwort ein.').max(512),
  code: z.string().trim().min(1, 'Bitte gib den Code ein.').max(20),
})

export const POST = route('user', async ({ req, user, ip }) => {
  const body = await parseJson(req, schema)
  await disableMfa(user, body.password, body.code, ip)
  return json({ ok: true })
})
