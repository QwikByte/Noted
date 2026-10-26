import 'server-only'
// Tags umbenennen und zusammenführen – in allen eigenen Notizen auf einmal, samt Unter-Tags
import { getDb } from '@/shared/server/db'
import { badRequest } from '@/shared/server/http'
import { makeExcerpt, normalizeTag } from '@/shared/markdown/meta'
import { noteText } from '../format'
import { renameTagIn } from '../tag-rewrite'
import { indexNote } from './notes'
import { saveSnapshot } from './versions'
import type { NoteFormat } from '../types'

type Row = {
  id: string
  user_id: number
  version: number
  title: string
  title_enc: string | null
  format: NoteFormat
  content: string
  created_at: number
}

/**
 * Tag `from` in `to` umbenennen – gibt es `to` schon, sind beide danach zusammengeführt. Vor jeder geänderten Notiz
 * wird ihr Stand im Verlauf gesichert. Tresor-Notizen kann der Server nicht lesen; sie bleiben unverändert.
 */
export function renameTag(userId: number, fromInput: string, toInput: string): { notes: number } {
  const from = normalizeTag(fromInput)
  const to = normalizeTag(toInput)
  if (!from) throw badRequest('Diesen Tag gibt es nicht.')
  if (!to) throw badRequest('Ein Tag besteht aus Buchstaben, Ziffern, „-“, „_“ und „/“ – und nicht nur aus Ziffern.')
  // Groß- und Kleinschreibung ist bei Tags egal – „#Mathe“ ist schon „#mathe“
  if (from === to) return { notes: 0 }
  const name = toInput.trim().replace(/^#+/, '').replace(/\/+$/, '')
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT DISTINCT n.id, n.user_id, n.version, n.title, n.title_enc, n.format, n.content, n.created_at
       FROM notes n JOIN note_tags t ON t.note_id = n.id
       WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.vault = 0 AND (t.tag = ? OR t.tag LIKE ? ESCAPE '\\')`,
    )
    .all(userId, from, from.replace(/[\\%_]/g, '\\$&') + '/%') as Row[]
  const now = Date.now()
  let notes = 0
  db.transaction(() => {
    for (const row of rows) {
      const content = renameTagIn(row.format, row.content, from, name)
      if (content === row.content) continue
      saveSnapshot(db, row, 'edit', now)
      const text = noteText(row.format, content)
      db.prepare(
        'UPDATE notes SET content = ?, excerpt = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?',
      ).run(content, makeExcerpt(text), now, row.id, userId)
      indexNote(db, { id: row.id, user_id: userId, title: row.title, text })
      notes++
    }
  })()
  return { notes }
}
