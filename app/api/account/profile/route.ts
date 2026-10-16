import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getUserById, toPublicUser, updateUser } from '@/features/auth/server/users'

const schema = z.object({
  displayName: z.string().trim().max(80, 'Der Anzeigename ist zu lang.'),
})

export const PATCH = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema)
  updateUser(user.id, { display_name: body.displayName })
  return json({ user: toPublicUser(getUserById(user.id)!) })
})
