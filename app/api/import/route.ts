import { badRequest, json, readForm, route } from '@/lib/server/http'
import { getConfig } from '@/lib/server/config'
import { importFiles } from '@/lib/server/vault'
import { isValidId } from '@/lib/server/notes'

/** Import von .md-Dateien, ZIP-Archiven (Obsidian-Vault) und sonstigen Dateien (als Anhänge) */
export const POST = route('user', async ({ req, user }) => {
  const form = await readForm(req, getConfig().maxImportBytes + 1024 * 1024)
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) throw badRequest('Keine Dateien übermittelt.')
  const folder = form.get('folderId')
  const folderId = typeof folder === 'string' && isValidId(folder) ? folder : null
  return json(await importFiles(user.id, files, folderId))
})
