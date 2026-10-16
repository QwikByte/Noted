import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { listBacklinks } from '@/features/notes/server/notes'

export const GET = route<{ id: string }>('user', ({ user, params }) => json({ backlinks: listBacklinks(user.id, params.id) }))
