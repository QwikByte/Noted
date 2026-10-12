import { z } from 'zod'
import { json, parseJson, route } from '@/lib/server/http'
import { createFolder, listFolders } from '@/lib/server/notes'

export const GET = route('user', ({ user }) => json({ folders: listFolders(user.id) }))

const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().max(300),
  parentId: z.string().uuid().nullable().default(null),
})

export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema)
  return json({ folder: createFolder(user.id, body) }, { status: 201 })
})
