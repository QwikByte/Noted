import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { deleteSheet, sheetSchema, updateSheet } from '@/features/coursework/server/coursework'

export const PUT = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, sheetSchema, 16 * 1024)
  return json({ sheet: updateSheet(user.id, params.id, body) })
})

/** Blatt und seinen Abgabetermin löschen */
export const DELETE = route<{ id: string }>('user', ({ user, params }) => {
  deleteSheet(user.id, params.id)
  return json({ ok: true })
})
