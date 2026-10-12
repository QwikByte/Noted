import { json, route } from '@/lib/server/http'
import { restoreNote } from '@/lib/server/notes'

export const POST = route<{ id: string }>('user', ({ user, params }) => json({ note: restoreNote(user.id, params.id) }))
