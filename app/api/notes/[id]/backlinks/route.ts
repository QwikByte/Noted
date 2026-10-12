import { json, route } from '@/lib/server/http'
import { listBacklinks } from '@/lib/server/notes'

export const GET = route<{ id: string }>('user', ({ user, params }) => json({ backlinks: listBacklinks(user.id, params.id) }))
