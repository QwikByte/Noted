import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { createSheet, sheetSchema } from '@/features/coursework/server/coursework'

export const POST = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, sheetSchema, 16 * 1024)
  return json({ sheet: createSheet(user.id, params.id, body) }, { status: 201 })
})
