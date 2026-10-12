import { z } from 'zod'
import { json, parseJson, route } from '@/lib/server/http'
import { disableMfa } from '@/lib/server/auth'

const schema = z.object({
  password: z.string().min(1, 'Bitte gib dein Passwort ein.').max(512),
  code: z.string().trim().min(1, 'Bitte gib den Code ein.').max(20),
})

export const POST = route('user', async ({ req, user, ip }) => {
  const body = await parseJson(req, schema)
  await disableMfa(user, body.password, body.code, ip)
  return json({ ok: true })
})
