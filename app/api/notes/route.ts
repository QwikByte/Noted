import { z } from 'zod'
import { json, parseJson, route } from '@/lib/server/http'
import { createNote, listNotes } from '@/lib/server/notes'

export const GET = route('user', ({ user }) => json({ notes: listNotes(user.id) }))

const schema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().max(300),
  folderId: z.string().uuid().nullable().default(null),
  content: z.string().default(''),
  pinned: z.boolean().optional(),
})

export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema)
  return json({ note: createNote(user.id, body) }, { status: 201 })
})
