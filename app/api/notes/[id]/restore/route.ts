import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { restoreNote } from '@/features/notes/server/notes'

export const POST = route<{ id: string }>('user', ({ user, params }) => json({ note: restoreNote(user.id, params.id) }))
