import { json, route } from '@/lib/server/http'
import { listTags } from '@/lib/server/notes'

export const GET = route('user', ({ user }) => json({ tags: listTags(user.id) }))
