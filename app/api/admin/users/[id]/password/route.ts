import { z } from 'zod'
import { json, parseJson, route } from '@/lib/server/http'
import { adminResetPassword } from '@/lib/server/admin'

const schema = z.object({ password: z.string().max(256).optional() })

/** Passwort zurücksetzen (neues Passwort angeben oder generieren lassen) */
export const POST = route<{ id: string }>('admin', async ({ req, user, ip, params }) => {
  const body = await parseJson(req, schema)
  return json(await adminResetPassword({ user, ip }, Number(params.id), body.password || undefined))
})
