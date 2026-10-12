import { badRequest, json, route } from '@/lib/server/http'
import { listAttachments, saveAttachment } from '@/lib/server/attachments'

export const GET = route('user', ({ user }) => json({ attachments: listAttachments(user.id) }))

/** Datei hochladen (multipart/form-data, Feld „file“) */
export const POST = route('user', async ({ req, user }) => {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    throw badRequest('Ungültiger Upload.')
  }
  const file = form.get('file')
  if (!(file instanceof File)) throw badRequest('Keine Datei übermittelt.')
  const attachment = saveAttachment(user.id, {
    name: file.name,
    type: file.type,
    data: new Uint8Array(await file.arrayBuffer()),
  })
  return json({ attachment }, { status: 201 })
})
