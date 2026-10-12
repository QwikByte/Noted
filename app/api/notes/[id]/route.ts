import { z } from 'zod'
import { json, parseJson, route } from '@/lib/server/http'
import { deleteNotePermanently, getNote, trashNote, updateNote } from '@/lib/server/notes'

export const GET = route<{ id: string }>('user', ({ user, params }) => json({ note: getNote(user.id, params.id) }))

const schema = z.object({
  title: z.string().max(300).optional(),
  folderId: z.string().uuid().nullable().optional(),
  content: z.string().optional(),
  pinned: z.boolean().optional(),
  baseVersion: z.number().int().optional(),
  autoRename: z.boolean().optional(),
})

export const PUT = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, schema)
  return json(updateNote(user.id, params.id, body))
})

/** In den Papierkorb verschieben – mit ?permanent=1 endgültig löschen */
export const DELETE = route<{ id: string }>('user', ({ req, user, params }) => {
  if (req.nextUrl.searchParams.get('permanent') === '1') deleteNotePermanently(user.id, params.id)
  else trashNote(user.id, params.id)
  return json({ ok: true })
})
