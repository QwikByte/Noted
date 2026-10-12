import { z } from 'zod'
import { json, parseJson, route } from '@/lib/server/http'
import { listUsersForAdmin, toPublicUser } from '@/lib/server/users'
import { adminCreateUser } from '@/lib/server/admin'

export const GET = route('admin', () => {
  return json({ users: listUsersForAdmin() })
})

const createSchema = z.object({
  username: z.string().trim().min(1, 'Bitte gib einen Benutzernamen ein.').max(32),
  displayName: z.string().trim().max(80).default(''),
  role: z.enum(['admin', 'user']).default('user'),
  password: z.string().max(256).optional(),
  mfaRequired: z.boolean().default(false),
})

export const POST = route('admin', async ({ req, user, ip }) => {
  const body = await parseJson(req, createSchema)
  const result = await adminCreateUser({ user, ip }, body)
  return json({ user: toPublicUser(result.user), password: result.password }, { status: 201 })
})
