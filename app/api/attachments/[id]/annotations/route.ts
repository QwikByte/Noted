import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { annotationsInputSchema, listAnnotations, saveAnnotations } from '@/features/pdf/server/annotations'

/** Anmerkungen eines PDFs */
export const GET = route<{ id: string }>('user', ({ user, params }) =>
  json({ annotations: listAnnotations(user.id, params.id) }),
)

/** Anmerkungen anlegen oder ändern (idempotent per ID, auch offline gesammelte) */
export const PUT = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, annotationsInputSchema, 16 * 1024 * 1024)
  return json(saveAnnotations(user.id, params.id, body.annotations))
})
