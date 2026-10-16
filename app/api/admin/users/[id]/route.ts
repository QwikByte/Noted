import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { toPublicUser } from '@/features/auth/server/users'
import { adminDeleteUser, adminUpdateUser } from '@/features/admin/server/admin'

const patchSchema = z.object({
  displayName: z.string().trim().max(80).optional(),
  role: z.enum(['admin', 'user']).optional(),
  isActive: z.boolean().optional(),
  mfaRequired: z.boolean().optional(),
  unlock: z.boolean().optional(),
})

export const PATCH = route<{ id: string }>('admin', async ({ req, user, ip, params }) => {
  const body = await parseJson(req, patchSchema)
  const updated = adminUpdateUser({ user, ip }, Number(params.id), body)
  return json({ user: toPublicUser(updated) })
})

export const DELETE = route<{ id: string }>('admin', ({ user, ip, params }) => {
  adminDeleteUser({ user, ip }, Number(params.id))
  return json({ ok: true })
})
