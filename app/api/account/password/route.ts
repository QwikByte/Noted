import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { changePassword } from '@/features/auth/server/auth'

const schema = z.object({
  currentPassword: z.string().min(1, 'Bitte gib dein aktuelles Passwort ein.').max(512),
  newPassword: z.string().min(1, 'Bitte gib ein neues Passwort ein.').max(512),
})

export const POST = route('setup', async ({ req, user, session, ip }) => {
  const body = await parseJson(req, schema)
  await changePassword(user, session, body.currentPassword, body.newPassword, ip)
  return json({ ok: true })
})
