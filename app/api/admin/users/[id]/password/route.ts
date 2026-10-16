import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { adminResetPassword } from '@/features/admin/server/admin'

const schema = z.object({ password: z.string().max(256).optional() })

/** Passwort zurücksetzen (neues Passwort angeben oder generieren lassen) */
export const POST = route<{ id: string }>('admin', async ({ req, user, ip, params }) => {
  const body = await parseJson(req, schema)
  return json(await adminResetPassword({ user, ip }, Number(params.id), body.password || undefined))
})
