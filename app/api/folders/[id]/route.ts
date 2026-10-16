import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { deleteFolder, updateFolder } from '@/features/notes/server/notes'

const schema = z.object({
  name: z.string().max(300).optional(),
  parentId: z.string().uuid().nullable().optional(),
})

export const PATCH = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, schema)
  return json({ folder: updateFolder(user.id, params.id, body) })
})

export const DELETE = route<{ id: string }>('user', ({ user, params }) => {
  return json(deleteFolder(user.id, params.id))
})
