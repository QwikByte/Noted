import 'server-only'
import { getDb } from '@/shared/server/db'
import { notFound } from '@/shared/server/http'
import { listFolders } from '@/features/notes/server/notes'
import { noteText } from '@/features/notes/format'
import type { NoteFormat } from '@/features/notes/types'
import { buildGlossary } from '../glossary'
import type { Glossary } from '../types'

/** Formate mit Markdown – formatierter Text (HTML) kennt weder Callouts noch Formeln, einfacher Text keine Formatierung */
const FORMATS: NoteFormat[] = ['markdown', 'mindmap', 'canvas']

/** Glossar aller Notizen – oder nur eines Ordners samt Unterordnern */
export function getGlossary(userId: number, folderId: string | null): Glossary {
  let folders: Set<string> | null = null
  if (folderId) {
    const all = listFolders(userId)
    if (!all.some((f) => f.id === folderId)) throw notFound('Ordner nicht gefunden.')
    folders = new Set([folderId])
    // Unterordner einsammeln, bis nichts mehr dazukommt
    for (let added = true; added; ) {
      added = false
      for (const f of all) {
        if (f.parentId && folders.has(f.parentId) && !folders.has(f.id)) {
          folders.add(f.id)
          added = true
        }
      }
    }
  }
  const rows = getDb()
    .prepare(
      `SELECT id, title, format, content, folder_id FROM notes
       WHERE user_id = ? AND deleted_at IS NULL AND format IN (${FORMATS.map(() => '?').join(', ')})`,
    )
    .all(userId, ...FORMATS) as { id: string; title: string; format: NoteFormat; content: string; folder_id: string | null }[]
  return buildGlossary(
    rows
      .filter((r) => !folders || (r.folder_id !== null && folders.has(r.folder_id)))
      .map((r) => ({ id: r.id, title: r.title, text: noteText(r.format, r.content) })),
  )
}
