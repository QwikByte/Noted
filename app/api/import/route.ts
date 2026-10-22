import { badRequest, json, readForm } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getConfig } from '@/shared/server/config'
import { importFiles } from '@/features/transfer/server/transfer'
import { isValidId } from '@/shared/server/crypto'
import { isTimeZone } from '@/features/calendar/ics'

/** Import von .md-Dateien, Kalendern (.ics), ZIP-Archiven und sonstigen Dateien (als Anhänge) */
export const POST = route('user', async ({ req, user }) => {
  const form = await readForm(req, getConfig().maxImportBytes + 1024 * 1024)
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) throw badRequest('Keine Dateien übermittelt.')
  const folder = form.get('folderId')
  const folderId = typeof folder === 'string' && isValidId(folder) ? folder : null
  // Zeiten aus .ics-Dateien gelten in der Zeitzone des Browsers (ohne gültige Angabe in der des Servers)
  const zone = form.get('timeZone')
  const timeZone =
    typeof zone === 'string' && zone.length <= 100 && isTimeZone(zone) ? zone : Intl.DateTimeFormat().resolvedOptions().timeZone
  return json(await importFiles(user.id, files, folderId, timeZone))
})
