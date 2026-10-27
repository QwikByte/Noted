import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { suggestMeta } from '@/features/ai/server/meta'
import { metaRequestSchema } from '@/features/ai/schemas'

/** Titel und Tags für eine Notiz vorschlagen lassen */
export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, metaRequestSchema, 8 * 1024 * 1024)
  return json(await suggestMeta(user.id, body, req.signal))
})
