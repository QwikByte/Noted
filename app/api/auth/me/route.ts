import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { pendingSetup, toPublicUser } from '@/features/auth/server/users'

export const GET = route('setup', ({ user }) => {
  return json({ user: toPublicUser(user), setup: pendingSetup(user) })
})
