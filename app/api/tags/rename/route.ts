import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { renameTag } from '@/features/notes/server/tags'

const schema = z.object({
  from: z.string().trim().min(1, 'Welcher Tag?').max(200, 'Der Tag ist zu lang.'),
  to: z.string().trim().min(1, 'Gib einen neuen Namen ein.').max(200, 'Der Name ist zu lang.'),
})

/** Tag in allen eigenen Notizen umbenennen bzw. mit einem vorhandenen zusammenführen */
export const POST = route('user', async ({ req, user }) => {
  const { from, to } = await parseJson(req, schema)
  return json(renameTag(user.id, from, to))
})
