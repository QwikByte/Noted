import { badRequest, json, readForm } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getConfig } from '@/shared/server/config'
import { importFiles } from '@/features/vault/server/vault'
import { isValidId } from '@/shared/server/crypto'

/** Import von .md-Dateien, ZIP-Archiven (Obsidian-Vault) und sonstigen Dateien (als Anhänge) */
export const POST = route('user', async ({ req, user }) => {
  const form = await readForm(req, getConfig().maxImportBytes + 1024 * 1024)
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) throw badRequest('Keine Dateien übermittelt.')
  const folder = form.get('folderId')
  const folderId = typeof folder === 'string' && isValidId(folder) ? folder : null
  return json(await importFiles(user.id, files, folderId))
})
