import 'server-only'
import type Database from 'better-sqlite3'
import { getDb } from './db'
import { badRequest, conflict, notFound } from './http'
import { uuid } from './crypto'
import { getConfig } from './config'
import { extractLinks, extractTags, linkKey, makeExcerpt } from '@/lib/shared/markdown-meta'
import { uniqueName, validateName } from '@/lib/shared/names'
import type { Folder, Note, NoteSummary, SearchResult, TagCount, TrashedNote } from '@/lib/shared/types'

export const MAX_NOTE_LENGTH = 2_000_000 // ca. 2 MB Text pro Notiz

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id)
}

type FolderRow = {
  id: string
  user_id: number
  parent_id: string | null
  name: string
  created_at: number
  updated_at: number
}

type NoteRow = {
  id: string
  user_id: number
  folder_id: string | null
  title: string
  content: string
  excerpt: string
  pinned: number
  version: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

const toFolder = (r: FolderRow): Folder => ({
  id: r.id,
  parentId: r.parent_id,
  name: r.name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

function tagsFor(db: Database.Database, noteId: string): string[] {
  return (db.prepare('SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag').all(noteId) as { tag: string }[]).map(
    (r) => r.tag,
  )
}

function toNote(db: Database.Database, r: NoteRow): Note {
  return {
    id: r.id,
    folderId: r.folder_id,
    title: r.title,
    pinned: r.pinned === 1,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: tagsFor(db, r.id),
    excerpt: r.excerpt,
    content: r.content,
  }
}

// ---------------------------------------------------------------------------
// Ordner
// ---------------------------------------------------------------------------

export function listFolders(userId: number): Folder[] {
  const rows = getDb()
    .prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY name COLLATE NOCASE')
    .all(userId) as FolderRow[]
  return rows.map(toFolder)
}

function getFolderRow(userId: number, id: string): FolderRow {
  const row = getDb().prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').get(id, userId) as
    | FolderRow
    | undefined
  if (!row) throw notFound('Ordner nicht gefunden.')
  return row
}

function assertFolder(userId: number, folderId: string | null) {
  if (folderId !== null) getFolderRow(userId, folderId)
}

function siblingFolderNames(userId: number, parentId: string | null, excludeId?: string): string[] {
  return (
    getDb()
      .prepare('SELECT name FROM folders WHERE user_id = ? AND parent_id IS ? AND id != ?')
      .all(userId, parentId, excludeId ?? '') as { name: string }[]
  ).map((r) => r.name)
}

export function createFolder(userId: number, input: { id?: string; name: string; parentId: string | null }): Folder {
  const name = input.name.trim()
  const error = validateName(name)
  if (error) throw badRequest(error)
  assertFolder(userId, input.parentId)
  const taken = siblingFolderNames(userId, input.parentId)
  if (taken.some((n) => n.toLowerCase() === name.toLowerCase())) {
    throw conflict('Hier gibt es bereits einen Ordner mit diesem Namen.', 'name_taken')
  }
  const id = input.id && isValidId(input.id) ? input.id : uuid()
  const t = Date.now()
  getDb()
    .prepare('INSERT INTO folders (id, user_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, input.parentId, name, t, t)
  return toFolder(getFolderRow(userId, id))
}

/** Alle Unterordner (rekursiv) inkl. des Ordners selbst. */
function descendantIds(userId: number, id: string): string[] {
  const rows = getDb()
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM folders WHERE id = ? AND user_id = ?
         UNION ALL
         SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
       )
       SELECT id FROM tree`,
    )
    .all(id, userId) as { id: string }[]
  return rows.map((r) => r.id)
}

export function updateFolder(userId: number, id: string, patch: { name?: string; parentId?: string | null }): Folder {
  const folder = getFolderRow(userId, id)
  const name = patch.name !== undefined ? patch.name.trim() : folder.name
  const parentId = patch.parentId !== undefined ? patch.parentId : folder.parent_id
  const error = validateName(name)
  if (error) throw badRequest(error)
  if (parentId !== null) {
    assertFolder(userId, parentId)
    if (descendantIds(userId, id).includes(parentId)) {
      throw badRequest('Ein Ordner kann nicht in sich selbst verschoben werden.')
    }
  }
  if (siblingFolderNames(userId, parentId, id).some((n) => n.toLowerCase() === name.toLowerCase())) {
    throw conflict('Hier gibt es bereits einen Ordner mit diesem Namen.', 'name_taken')
  }
  getDb()
    .prepare('UPDATE folders SET name = ?, parent_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(name, parentId, Date.now(), id, userId)
  return toFolder(getFolderRow(userId, id))
}

/** Löscht einen Ordner samt Unterordnern. Enthaltene Notizen landen im Papierkorb. */
export function deleteFolder(userId: number, id: string): { trashedNotes: number } {
  getFolderRow(userId, id)
  const db = getDb()
  const ids = descendantIds(userId, id)
  let trashed = 0
  db.transaction(() => {
    const t = Date.now()
    const stmt = db.prepare(
      'UPDATE notes SET deleted_at = ?, folder_id = NULL WHERE folder_id = ? AND user_id = ? AND deleted_at IS NULL',
    )
    const detach = db.prepare('UPDATE notes SET folder_id = NULL WHERE folder_id = ? AND user_id = ?')
    for (const fid of ids) {
      trashed += stmt.run(t, fid, userId).changes
      detach.run(fid, userId) // bereits gelöschte Notizen ebenfalls lösen
    }
    db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').run(id, userId)
  })()
  return { trashedNotes: trashed }
}

// ---------------------------------------------------------------------------
// Notizen
// ---------------------------------------------------------------------------

function indexNote(db: Database.Database, note: { id: string; user_id: number; title: string; content: string }) {
  db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(note.id)
  db.prepare('DELETE FROM note_links WHERE note_id = ?').run(note.id)
  db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(note.id)
  const insTag = db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)')
  for (const tag of extractTags(note.content)) insTag.run(note.id, tag)
  const insLink = db.prepare('INSERT OR IGNORE INTO note_links (note_id, target) VALUES (?, ?)')
  for (const target of extractLinks(note.content)) insLink.run(note.id, target)
  db.prepare('INSERT INTO notes_fts (note_id, user_id, title, content) VALUES (?, ?, ?, ?)').run(
    note.id,
    note.user_id,
    note.title,
    note.content,
  )
}

function unindexNote(db: Database.Database, noteId: string) {
  db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(noteId)
}

function getNoteRow(userId: number, id: string, opts: { includeDeleted?: boolean } = {}): NoteRow {
  const row = getDb()
    .prepare(`SELECT * FROM notes WHERE id = ? AND user_id = ? ${opts.includeDeleted ? '' : 'AND deleted_at IS NULL'}`)
    .get(id, userId) as NoteRow | undefined
  if (!row) throw notFound('Notiz nicht gefunden.')
  return row
}

function noteTitlesInFolder(userId: number, folderId: string | null, excludeId?: string): string[] {
  return (
    getDb()
      .prepare('SELECT title FROM notes WHERE user_id = ? AND folder_id IS ? AND deleted_at IS NULL AND id != ?')
      .all(userId, folderId, excludeId ?? '') as { title: string }[]
  ).map((r) => r.title)
}

export function listNotes(userId: number): NoteSummary[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT n.id, n.folder_id, n.title, n.excerpt, n.pinned, n.version, n.created_at, n.updated_at,
              (SELECT GROUP_CONCAT(tag, char(31)) FROM note_tags t WHERE t.note_id = n.id) AS tags
       FROM notes n WHERE n.user_id = ? AND n.deleted_at IS NULL
       ORDER BY n.updated_at DESC`,
    )
    .all(userId) as (Omit<NoteRow, 'content' | 'user_id' | 'deleted_at'> & { tags: string | null })[]
  return rows.map((r) => ({
    id: r.id,
    folderId: r.folder_id,
    title: r.title,
    pinned: r.pinned === 1,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: r.tags ? r.tags.split('\u001f').sort() : [],
    excerpt: r.excerpt,
  }))
}

export function getNote(userId: number, id: string): Note {
  return toNote(getDb(), getNoteRow(userId, id))
}

function checkContent(content: string) {
  if (content.length > MAX_NOTE_LENGTH) throw badRequest('Die Notiz ist zu groß.')
}

export function createNote(
  userId: number,
  input: { id?: string; title: string; folderId: string | null; content: string; pinned?: boolean },
): Note {
  const db = getDb()
  const title = input.title.trim()
  const error = validateName(title)
  if (error) throw badRequest(error)
  checkContent(input.content)
  assertFolder(userId, input.folderId)

  if (input.id !== undefined) {
    if (!isValidId(input.id)) throw badRequest('Ungültige ID.')
    const existing = db.prepare('SELECT user_id FROM notes WHERE id = ?').get(input.id) as { user_id: number } | undefined
    if (existing) {
      // Wiederholte Anfrage (z. B. Offline-Synchronisierung): bestehende Notiz zurückgeben
      if (existing.user_id === userId) return getNote(userId, input.id)
      throw conflict('Diese ID ist bereits vergeben.')
    }
  }
  const id = input.id ?? uuid()
  const finalTitle = uniqueName(title, noteTitlesInFolder(userId, input.folderId))
  const t = Date.now()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO notes (id, user_id, folder_id, title, content, excerpt, pinned, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(id, userId, input.folderId, finalTitle, input.content, makeExcerpt(input.content), input.pinned ? 1 : 0, t, t)
    indexNote(db, { id, user_id: userId, title: finalTitle, content: input.content })
  })()
  return getNote(userId, id)
}

export type NotePatch = {
  title?: string
  folderId?: string | null
  content?: string
  pinned?: boolean
  /** Version, auf der die Änderung basiert (Konflikterkennung) */
  baseVersion?: number
  /** Bei Titel-Konflikt automatisch einen freien Namen wählen statt Fehler */
  autoRename?: boolean
}

export function updateNote(userId: number, id: string, patch: NotePatch): { note: Note; linksUpdated: number } {
  const db = getDb()
  const current = getNoteRow(userId, id)
  const contentChanged = patch.content !== undefined && patch.content !== current.content
  let title = current.title
  if (patch.title !== undefined && patch.title.trim() !== current.title) {
    title = patch.title.trim()
    const error = validateName(title)
    if (error) throw badRequest(error)
  }
  const titleChanged = title !== current.title
  const folderId = patch.folderId !== undefined ? patch.folderId : current.folder_id
  const folderChanged = folderId !== current.folder_id

  if (
    patch.baseVersion !== undefined &&
    patch.baseVersion !== current.version &&
    (contentChanged || titleChanged)
  ) {
    throw conflict('Die Notiz wurde inzwischen an anderer Stelle geändert.', 'version_conflict', {
      note: toNote(db, current),
    })
  }
  if (patch.content !== undefined) checkContent(patch.content)
  if (folderChanged) assertFolder(userId, folderId)
  if (titleChanged || folderChanged) {
    const taken = noteTitlesInFolder(userId, folderId, id)
    if (taken.some((n) => n.toLowerCase() === title.toLowerCase())) {
      if (patch.autoRename) title = uniqueName(title, taken)
      else throw conflict('In diesem Ordner gibt es bereits eine Notiz mit diesem Titel.', 'title_taken')
    }
  }

  const content = patch.content ?? current.content
  const pinned = patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : current.pinned
  const bump = contentChanged || title !== current.title
  let linksUpdated = 0

  db.transaction(() => {
    db.prepare(
      `UPDATE notes SET title = ?, folder_id = ?, content = ?, excerpt = ?, pinned = ?,
         version = version + ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      title,
      folderId,
      content,
      contentChanged ? makeExcerpt(content) : current.excerpt,
      pinned,
      bump ? 1 : 0,
      bump || folderChanged ? Date.now() : current.updated_at,
      id,
      userId,
    )
    if (bump) indexNote(db, { id, user_id: userId, title, content })
    if (title !== current.title) linksUpdated = rewriteLinks(db, userId, id, current.title, title)
  })()
  return { note: getNote(userId, id), linksUpdated }
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Ersetzt [[Alt]], [[Alt|…]], [[Alt#…]], [[Ordner/Alt]] in allen verlinkenden Notizen. */
function rewriteLinks(db: Database.Database, userId: number, noteId: string, oldTitle: string, newTitle: string): number {
  const key = linkKey(oldTitle)
  const sources = db
    .prepare(
      `SELECT n.* FROM notes n JOIN note_links l ON l.note_id = n.id
       WHERE n.user_id = ? AND n.deleted_at IS NULL AND l.target = ? AND n.id != ?`,
    )
    .all(userId, key, noteId) as NoteRow[]
  // Gibt es noch eine andere Notiz mit dem alten Titel, sind die Links mehrdeutig – dann nichts ändern
  const other = db
    .prepare('SELECT 1 FROM notes WHERE user_id = ? AND deleted_at IS NULL AND id != ? AND lower(title) = ?')
    .get(userId, noteId, key)
  if (other) return 0

  const re = new RegExp(`(!?\\[\\[)((?:[^\\]|#\\n]*/)?)${escapeRegExp(oldTitle)}(\\.md)?(?=[\\]|#])`, 'gi')
  let count = 0
  for (const src of sources) {
    const content = src.content.replace(re, (_m, open: string, prefix: string) => {
      count++
      return `${open}${prefix}${newTitle}`
    })
    if (content !== src.content) {
      db.prepare(
        'UPDATE notes SET content = ?, excerpt = ?, version = version + 1, updated_at = ? WHERE id = ?',
      ).run(content, makeExcerpt(content), Date.now(), src.id)
      indexNote(db, { id: src.id, user_id: userId, title: src.title, content })
    }
  }
  return count
}

export function trashNote(userId: number, id: string) {
  const db = getDb()
  getNoteRow(userId, id)
  db.transaction(() => {
    db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ? AND user_id = ?').run(Date.now(), id, userId)
    unindexNote(db, id)
  })()
}

export function restoreNote(userId: number, id: string): Note {
  const db = getDb()
  const row = getNoteRow(userId, id, { includeDeleted: true })
  if (row.deleted_at === null) return toNote(db, row)
  const folderExists =
    row.folder_id !== null && db.prepare('SELECT 1 FROM folders WHERE id = ? AND user_id = ?').get(row.folder_id, userId)
  const folderId = folderExists ? row.folder_id : null
  const title = uniqueName(row.title, noteTitlesInFolder(userId, folderId, id))
  db.transaction(() => {
    db.prepare('UPDATE notes SET deleted_at = NULL, folder_id = ?, title = ?, updated_at = ? WHERE id = ?').run(
      folderId,
      title,
      Date.now(),
      id,
    )
    indexNote(db, { id, user_id: userId, title, content: row.content })
  })()
  return getNote(userId, id)
}

export function deleteNotePermanently(userId: number, id: string) {
  const db = getDb()
  getNoteRow(userId, id, { includeDeleted: true })
  db.transaction(() => {
    unindexNote(db, id)
    db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, userId)
  })()
}

export function listTrash(userId: number): TrashedNote[] {
  purgeTrash(userId)
  return (
    getDb()
      .prepare(
        `SELECT id, title, folder_id AS folderId, deleted_at AS deletedAt, updated_at AS updatedAt
         FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
      )
      .all(userId) as TrashedNote[]
  )
}

export function emptyTrash(userId: number): number {
  const db = getDb()
  return db.transaction(() => {
    const ids = db.prepare('SELECT id FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL').all(userId) as {
      id: string
    }[]
    for (const { id } of ids) unindexNote(db, id)
    return db.prepare('DELETE FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL').run(userId).changes
  })()
}

/** Notizen, die länger als TRASH_DAYS im Papierkorb liegen, endgültig löschen. */
export function purgeTrash(userId?: number) {
  const cutoff = Date.now() - getConfig().trashDays * 86_400_000
  const db = getDb()
  db.transaction(() => {
    const rows = db
      .prepare(`SELECT id FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ? ${userId ? 'AND user_id = ?' : ''}`)
      .all(...(userId ? [cutoff, userId] : [cutoff])) as { id: string }[]
    const del = db.prepare('DELETE FROM notes WHERE id = ?')
    for (const { id } of rows) {
      unindexNote(db, id)
      del.run(id)
    }
  })()
}

// ---------------------------------------------------------------------------
// Suche, Tags, Backlinks
// ---------------------------------------------------------------------------

export const SNIPPET_START = '\u0002'
export const SNIPPET_END = '\u0003'

function buildFtsQuery(terms: string[]): string {
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ')
}

export function searchNotes(userId: number, query: string, limit = 50): SearchResult[] {
  const db = getDb()
  const parts = query.trim().split(/\s+/).filter(Boolean).slice(0, 12)
  const tags = parts.filter((p) => p.startsWith('#') && p.length > 1).map((p) => p.slice(1).toLowerCase())
  const terms = parts
    .filter((p) => !p.startsWith('#'))
    .map((p) => p.replace(/[\u0000-\u001f]/g, ''))
    .filter(Boolean)
  if (tags.length === 0 && terms.length === 0) return []

  const tagFilter = tags
    .map(() => `AND EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND (t.tag = ? OR t.tag LIKE ? ESCAPE '\\'))`)
    .join(' ')
  const tagParams = tags.flatMap((t) => [t, t.replace(/[\\%_]/g, '\\$&') + '/%'])

  if (terms.length === 0) {
    const rows = db
      .prepare(
        `SELECT n.id, n.title, n.folder_id AS folderId, n.excerpt AS snippet, n.updated_at AS updatedAt
         FROM notes n WHERE n.user_id = ? AND n.deleted_at IS NULL ${tagFilter}
         ORDER BY n.updated_at DESC LIMIT ?`,
      )
      .all(userId, ...tagParams, limit) as SearchResult[]
    return rows
  }

  try {
    return db
      .prepare(
        `SELECT n.id, n.title, n.folder_id AS folderId, n.updated_at AS updatedAt,
                snippet(notes_fts, 3, '${SNIPPET_START}', '${SNIPPET_END}', '…', 14) AS snippet
         FROM notes_fts f JOIN notes n ON n.id = f.note_id
         WHERE notes_fts MATCH ? AND f.user_id = ? AND n.deleted_at IS NULL ${tagFilter}
         ORDER BY bm25(notes_fts, 0.0, 0.0, 8.0, 1.0) LIMIT ?`,
      )
      .all(buildFtsQuery(terms), userId, ...tagParams, limit) as SearchResult[]
  } catch (err) {
    console.warn('[noted] Suchanfrage fehlgeschlagen', err)
    return []
  }
}

export function listTags(userId: number): TagCount[] {
  return getDb()
    .prepare(
      `SELECT t.tag, COUNT(*) AS count FROM note_tags t JOIN notes n ON n.id = t.note_id
       WHERE n.user_id = ? AND n.deleted_at IS NULL GROUP BY t.tag ORDER BY t.tag`,
    )
    .all(userId) as TagCount[]
}

export function listBacklinks(userId: number, id: string): { id: string; title: string; folderId: string | null }[] {
  const note = getNoteRow(userId, id)
  return getDb()
    .prepare(
      `SELECT n.id, n.title, n.folder_id AS folderId FROM notes n JOIN note_links l ON l.note_id = n.id
       WHERE n.user_id = ? AND n.deleted_at IS NULL AND l.target = ? AND n.id != ?
       ORDER BY n.updated_at DESC`,
    )
    .all(userId, linkKey(note.title), id) as { id: string; title: string; folderId: string | null }[]
}

/** Pfad eines Ordners als Array von Namen (für Export/Anzeige). */
export function folderPathMap(userId: number): Map<string, string[]> {
  const folders = listFolders(userId)
  const byId = new Map(folders.map((f) => [f.id, f]))
  const cache = new Map<string, string[]>()
  const resolve = (id: string, depth = 0): string[] => {
    if (cache.has(id)) return cache.get(id)!
    const f = byId.get(id)
    if (!f || depth > 64) return []
    const p = [...(f.parentId ? resolve(f.parentId, depth + 1) : []), f.name]
    cache.set(id, p)
    return p
  }
  for (const f of folders) resolve(f.id)
  return cache
}
