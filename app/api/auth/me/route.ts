import { json, route } from '@/lib/server/http'
import { pendingSetup, toPublicUser } from '@/lib/server/users'

export const GET = route('setup', ({ user }) => {
  return json({ user: toPublicUser(user), setup: pendingSetup(user) })
})
