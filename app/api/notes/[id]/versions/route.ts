import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { listVersions } from '@/features/notes/server/versions'

export const GET = route<{ id: string }>('user', ({ user, params }) => json({ versions: listVersions(user.id, params.id) }))
