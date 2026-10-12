import { z } from 'zod'
import { json, parseJson, route } from '@/lib/server/http'
import { getUserById, toPublicUser, updateUser } from '@/lib/server/users'

const schema = z.object({
  displayName: z.string().trim().max(80, 'Der Anzeigename ist zu lang.'),
})

export const PATCH = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema)
  updateUser(user.id, { display_name: body.displayName })
  return json({ user: toPublicUser(getUserById(user.id)!) })
})
