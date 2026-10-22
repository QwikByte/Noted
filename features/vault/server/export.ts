import 'server-only'
import { getDb } from '@/shared/server/db'
import { VAULT_FORMAT } from '../format'
import { getVault } from './vault'

/** Name der Datei im ZIP-Export */
export const VAULT_EXPORT_FILE = 'Tresor.noted-vault'

/**
 * Der Tresor im ZIP-Export – verschlüsselt, so wie er gespeichert ist: Schlüsselmaterial, Ordner und Notizen als
 * Umschläge. So bleibt der Export ein vollständiges Backup, ohne dass der Server etwas entschlüsseln muss.
 * `null`, wenn es keinen Tresor gibt.
 */
export function vaultExport(userId: number): { json: string; updatedAt: number } | null {
  const vault = getVault(userId)
  if (!vault) return null
  const db = getDb()
  const folders = db
    .prepare(
      `SELECT id, parent_id AS parentId, name_enc AS nameEnc, created_at AS createdAt, updated_at AS updatedAt
       FROM folders WHERE user_id = ? AND vault = 1 ORDER BY created_at`,
    )
    .all(userId) as {
    id: string
    parentId: string | null
    nameEnc: string | null
    createdAt: number
    updatedAt: number
  }[]
  const notes = db
    .prepare(
      `SELECT id, folder_id AS folderId, title_enc AS titleEnc, content, format, pinned, created_at AS createdAt,
              updated_at AS updatedAt
       FROM notes WHERE user_id = ? AND vault = 1 AND deleted_at IS NULL ORDER BY created_at`,
    )
    .all(userId) as { pinned: number; updatedAt: number }[]
  const updatedAt = Math.max(0, ...folders.map((f) => f.updatedAt), ...notes.map((n) => n.updatedAt))
  const { folderId, ...keys } = vault
  const data = {
    format: 'noted-vault',
    version: VAULT_FORMAT,
    rootFolderId: folderId,
    ...keys,
    folders: folders.map((f) => ({ ...f, parentId: f.id === folderId ? null : f.parentId })),
    notes: notes.map((n) => ({ ...n, pinned: n.pinned === 1 })),
  }
  return { json: JSON.stringify(data, null, 2), updatedAt: updatedAt || Date.now() }
}
