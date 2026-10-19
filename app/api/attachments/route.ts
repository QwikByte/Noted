import { badRequest, json, readForm } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getConfig } from '@/shared/server/config'
import { listAttachments, listFiles, saveAttachment } from '@/features/attachments/server/attachments'

/** Alle Dateien – mit ?notes=1 samt den Notizen, in denen sie vorkommen (für den Bereich „Dateien“) */
export const GET = route('user', ({ req, user }) =>
  json({ attachments: req.nextUrl.searchParams.get('notes') === '1' ? listFiles(user.id) : listAttachments(user.id) }),
)

/** Datei hochladen (multipart/form-data, Feld „file“) */
export const POST = route('user', async ({ req, user }) => {
  // Etwas Spielraum für die multipart-Verpackung
  const form = await readForm(req, getConfig().maxUploadBytes + 64 * 1024)
  const file = form.get('file')
  if (!(file instanceof File)) throw badRequest('Keine Datei übermittelt.')
  const attachment = saveAttachment(user.id, {
    name: file.name,
    type: file.type,
    data: new Uint8Array(await file.arrayBuffer()),
  })
  return json({ attachment }, { status: 201 })
})
