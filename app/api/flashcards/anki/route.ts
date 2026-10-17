import { badRequest, json, readForm } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getConfig } from '@/shared/server/config'
import { importAnki } from '@/features/flashcards/server/anki'

/** Anki-Paket (.apkg/.colpkg) importieren – `progress=1` übernimmt auch den Lernstand */
export const POST = route('user', async ({ req, user }) => {
  const form = await readForm(req, getConfig().maxImportBytes + 1024 * 1024)
  const file = form.get('file')
  if (!(file instanceof File)) throw badRequest('Keine Datei übermittelt.')
  return json(importAnki(user.id, new Uint8Array(await file.arrayBuffer()), { progress: form.get('progress') === '1' }))
})
