import { z } from 'zod'
import { json, parseJson, route } from '@/lib/server/http'
import { deleteFolder, updateFolder } from '@/lib/server/notes'

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
