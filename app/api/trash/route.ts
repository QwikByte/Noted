import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { emptyTrash, listTrash } from '@/features/notes/server/notes'

export const GET = route('user', ({ user }) => json({ notes: listTrash(user.id) }))

export const DELETE = route('user', ({ user }) => json({ deleted: emptyTrash(user.id) }))
