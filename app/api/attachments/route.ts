import { badRequest, json, readForm } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getConfig } from '@/shared/server/config'
import { listAttachments, saveAttachment } from '@/features/attachments/server/attachments'

export const GET = route('user', ({ user }) => json({ attachments: listAttachments(user.id) }))

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
