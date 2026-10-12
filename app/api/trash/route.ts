import { json, route } from '@/lib/server/http'
import { emptyTrash, listTrash } from '@/lib/server/notes'

export const GET = route('user', ({ user }) => json({ notes: listTrash(user.id) }))

export const DELETE = route('user', ({ user }) => json({ deleted: emptyTrash(user.id) }))
