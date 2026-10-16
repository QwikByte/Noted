// Pfade im exportierten Vault – gebraucht von Export/Import (Server) und beim Herunterladen eines Canvas (Browser)
import { noteExtension } from '@/features/notes/format'
import type { NoteFormat } from '@/features/notes/types'
import type { VaultIndex } from '@/features/canvas/canvas'
import { linkKey } from '@/shared/markdown/meta'

/** Alle Anhänge liegen im Export in diesem Ordner */
export const EXPORT_ATTACHMENT_FOLDER = 'Anhänge'

/** Pfad einer Notiz im Vault, z. B. „Uni/Mathe/Analysis.md“ */
export function vaultNotePath(folders: string[], title: string, format: NoteFormat): string {
  return [...folders, `${title}${noteExtension(format)}`].join('/')
}

/**
 * Pfade für die Dateikarten eines Canvas. `notes` in der Reihenfolge des Anlegens: Bei gleichem Titel in mehreren
 * Ordnern zeigt die Karte auf die älteste Notiz.
 */
export function buildVaultIndex(notes: { title: string; folders: string[]; format: NoteFormat }[], attachments: string[]): VaultIndex {
  const notePaths = new Map<string, string>()
  for (const n of notes) {
    const key = linkKey(n.title)
    if (!notePaths.has(key)) notePaths.set(key, vaultNotePath(n.folders, n.title, n.format))
  }
  return { attachmentFolder: EXPORT_ATTACHMENT_FOLDER, attachments, notePaths }
}
