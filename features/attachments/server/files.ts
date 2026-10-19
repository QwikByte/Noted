import 'server-only'
import path from 'node:path'
import { getConfig } from '@/shared/server/config'

/** Ablage der Dateien eines Nutzers: <ATTACHMENTS_DIR>/<Nutzer-ID>/<Datei-ID> */
export function userDir(userId: number) {
  return path.join(/*turbopackIgnore: true*/ getConfig().attachmentsDir, String(userId))
}

export function filePath(userId: number, id: string) {
  return path.join(/*turbopackIgnore: true*/ userDir(userId), id)
}
