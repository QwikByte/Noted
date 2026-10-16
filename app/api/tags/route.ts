import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { listTags } from '@/features/notes/server/notes'

export const GET = route('user', ({ user }) => json({ tags: listTags(user.id) }))
