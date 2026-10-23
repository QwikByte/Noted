import 'server-only'
import type Database from 'better-sqlite3'
import { getDb } from '@/shared/server/db'
import { badRequest, conflict, notFound } from '@/shared/server/http'
import { isValidId, uuid } from '@/shared/server/crypto'
import { getConfig } from '@/shared/server/config'
import { buildFtsQuery, SNIPPET_END, SNIPPET_START } from '@/shared/server/fts'
import { parseSearch } from '@/shared/lib/search-query'
import { extractLinks, extractTags, linkKey, makeExcerpt } from '@/shared/markdown/meta'
import { uniqueName, validateName } from '@/shared/lib/names'
import { escapeRegExp } from '@/shared/lib/regexp'
import { noteText } from '../format'
import { mapCanvasNodes, parseCanvas } from '@/features/canvas/canvas'
import { getVersion, snapshotIfDue } from './versions'
import {
  assertEnvelope,
  auditVaultMove,
  checkpoint,
  isVaultFolder,
  vaultBoundary,
  vaultRequired,
  vaultRootId,
} from '@/features/vault/server/vault'
import { MAX_VAULT_ENVELOPE_LENGTH, MAX_VAULT_TITLE_ENVELOPE_LENGTH } from '@/features/vault/limits'
import type {
  Folder,
  Note,
  NoteBatchAction,
  NoteBatchResult,
  NoteFormat,
  NoteSummary,
  NoteVersionReason,
  SearchResult,
  TagCount,
  TrashedNote,
} from '../types'

export const MAX_NOTE_LENGTH = 2_000_000 // ca. 2 MB Text pro Notiz

type Actor = { user: { id: number; username: string }; ip: string | null }

type FolderRow = {
  id: string
  user_id: number
  parent_id: string | null
  name: string
  created_at: number
  updated_at: number
  vault: number
  name_enc: string | null
}

type NoteRow = {
  id: string
  user_id: number
  folder_id: string | null
  title: string
  content: string
  format: NoteFormat
  excerpt: string
  pinned: number
  version: number
  created_at: number
  updated_at: number
  deleted_at: number | null
  vault: number
  title_enc: string | null
}

const toFolder = (r: FolderRow): Folder => ({
  id: r.id,
  parentId: r.parent_id,
  name: r.name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  vault: r.vault === 1,
  nameEnc: r.name_enc,
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
    format: r.format,
    pinned: r.pinned === 1,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: tagsFor(db, r.id),
    excerpt: r.excerpt,
    vault: r.vault === 1,
    titleEnc: r.title_enc,
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

export function createFolder(
  userId: number,
  input: { id?: string; name: string; parentId: string | null; nameEnc?: string },
): Folder {
  if (isVaultFolder(userId, input.parentId)) return createVaultFolder(userId, input)
  if (input.nameEnc !== undefined) throw vaultBoundary()
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

/** Unterordner im Tresor: Der Name ist verschlüsselt, Platzhalter ist die ID (sie steckt in der AAD des Namens) */
function createVaultFolder(
  userId: number,
  input: { id?: string; name: string; parentId: string | null; nameEnc?: string },
): Folder {
  if (!input.id || !isValidId(input.id) || (input.name !== '' && input.name !== input.id)) throw vaultRequired()
  const nameEnc = assertEnvelope(input.nameEnc, MAX_VAULT_TITLE_ENVELOPE_LENGTH)
  const existing = getDb().prepare('SELECT user_id FROM folders WHERE id = ?').get(input.id) as
    | { user_id: number }
    | undefined
  if (existing) {
    // Wiederholte Anfrage: bestehenden Ordner zurückgeben
    if (existing.user_id === userId) return toFolder(getFolderRow(userId, input.id))
    throw conflict('Diese ID ist bereits vergeben.')
  }
  const t = Date.now()
  getDb()
    .prepare(
      `INSERT INTO folders (id, user_id, parent_id, name, vault, name_enc, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(input.id, userId, input.parentId, input.id, nameEnc, t, t)
  return toFolder(getFolderRow(userId, input.id))
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

type FolderPatch = { name?: string; parentId?: string | null; nameEnc?: string }

export function updateFolder(userId: number, id: string, patch: FolderPatch): Folder {
  const folder = getFolderRow(userId, id)
  if (folder.vault === 1) return updateVaultFolder(userId, folder, patch)
  if (patch.nameEnc !== undefined) throw vaultBoundary()
  const name = patch.name !== undefined ? patch.name.trim() : folder.name
  const parentId = patch.parentId !== undefined ? patch.parentId : folder.parent_id
  const error = validateName(name)
  if (error) throw badRequest(error)
  if (parentId !== null) {
    assertFolder(userId, parentId)
    if (isVaultFolder(userId, parentId)) throw vaultBoundary()
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

/** Ordner im Tresor: umbenennen nur verschlüsselt, verschieben nur innerhalb des Tresors */
function updateVaultFolder(userId: number, folder: FolderRow, patch: FolderPatch): Folder {
  if (folder.id === vaultRootId(userId)) {
    throw badRequest('Den Ordner des Tresors kannst du weder umbenennen noch verschieben.')
  }
  if (patch.name !== undefined && patch.name !== folder.name) throw vaultRequired()
  const parentId = patch.parentId !== undefined ? patch.parentId : folder.parent_id
  if (!isVaultFolder(userId, parentId)) throw vaultBoundary()
  if (descendantIds(userId, folder.id).includes(parentId!)) {
    throw badRequest('Ein Ordner kann nicht in sich selbst verschoben werden.')
  }
  const nameEnc =
    patch.nameEnc !== undefined ? assertEnvelope(patch.nameEnc, MAX_VAULT_TITLE_ENVELOPE_LENGTH) : folder.name_enc
  getDb()
    .prepare('UPDATE folders SET name_enc = ?, parent_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(nameEnc, parentId, Date.now(), folder.id, userId)
  return toFolder(getFolderRow(userId, folder.id))
}

/** Löscht einen Ordner samt Unterordnern. Enthaltene Notizen landen im Papierkorb. */
export function deleteFolder(userId: number, id: string): { trashedNotes: number } {
  getFolderRow(userId, id)
  if (id === vaultRootId(userId)) throw badRequest('Den Tresor löschst du unter Einstellungen → Tresor.')
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

/** Tags, Links und Suchindex aus dem Text der Notiz (bei formatiertem Text ohne HTML, siehe noteText) */
function indexNote(db: Database.Database, note: { id: string; user_id: number; title: string; text: string }) {
  db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(note.id)
  db.prepare('DELETE FROM note_links WHERE note_id = ?').run(note.id)
  unindexNote(db, note.id)
  const insTag = db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)')
  for (const tag of extractTags(note.text)) insTag.run(note.id, tag)
  const insLink = db.prepare('INSERT OR IGNORE INTO note_links (note_id, target) VALUES (?, ?)')
  for (const target of extractLinks(note.text)) insLink.run(note.id, target)
  const info = db
    .prepare('INSERT INTO notes_fts (note_id, user_id, title, content) VALUES (?, ?, ?, ?)')
    .run(note.id, note.user_id, note.title, note.text)
  db.prepare('INSERT OR REPLACE INTO notes_fts_map (note_id, fts_rowid) VALUES (?, ?)').run(note.id, info.lastInsertRowid)
}

function unindexNote(db: Database.Database, noteId: string) {
  const row = db.prepare('SELECT fts_rowid FROM notes_fts_map WHERE note_id = ?').get(noteId) as
    | { fts_rowid: number }
    | undefined
  if (!row) return
  db.prepare('DELETE FROM notes_fts WHERE rowid = ?').run(row.fts_rowid)
  db.prepare('DELETE FROM notes_fts_map WHERE note_id = ?').run(noteId)
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
      `SELECT n.id, n.folder_id, n.title, n.format, n.excerpt, n.pinned, n.version, n.created_at, n.updated_at,
              n.vault, n.title_enc,
              (SELECT GROUP_CONCAT(tag, char(31)) FROM note_tags t WHERE t.note_id = n.id) AS tags
       FROM notes n WHERE n.user_id = ? AND n.deleted_at IS NULL
       ORDER BY n.updated_at DESC`,
    )
    .all(userId) as (Omit<NoteRow, 'content' | 'user_id' | 'deleted_at'> & { tags: string | null })[]
  return rows.map((r) => ({
    id: r.id,
    folderId: r.folder_id,
    title: r.title,
    format: r.format,
    pinned: r.pinned === 1,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: r.tags ? r.tags.split('\u001f').sort() : [],
    excerpt: r.excerpt,
    vault: r.vault === 1,
    titleEnc: r.title_enc,
  }))
}

export function getNote(userId: number, id: string): Note {
  return toNote(getDb(), getNoteRow(userId, id))
}

function checkContent(content: string, format: NoteFormat) {
  if (content.length > MAX_NOTE_LENGTH) throw badRequest('Die Notiz ist zu groß.')
  // Ein beschädigtes Canvas würde im Editor leer erscheinen und beim nächsten Speichern überschrieben
  if (format === 'canvas' && !parseCanvas(content)) throw badRequest('Das Canvas konnte nicht gelesen werden.')
}

type NoteInput = {
  id?: string
  title: string
  folderId: string | null
  content: string
  format?: NoteFormat
  pinned?: boolean
  /** Nur im Tresor: verschlüsselter Titel (`title` ist dann die ID oder leer, `content` ein Umschlag) */
  titleEnc?: string
}

export function createNote(userId: number, input: NoteInput): Note {
  if (isVaultFolder(userId, input.folderId)) return createVaultNote(userId, input)
  if (input.titleEnc !== undefined) throw vaultBoundary()
  const db = getDb()
  const title = input.title.trim()
  const error = validateName(title)
  if (error) throw badRequest(error)
  const format = input.format ?? 'markdown'
  checkContent(input.content, format)
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
  const text = noteText(format, input.content)
  const t = Date.now()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO notes (id, user_id, folder_id, title, content, format, excerpt, pinned, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(id, userId, input.folderId, finalTitle, input.content, format, makeExcerpt(text), input.pinned ? 1 : 0, t, t)
    indexNote(db, { id, user_id: userId, title: finalTitle, text })
  })()
  return getNote(userId, id)
}

/**
 * Notiz im Tresor: Titel und Inhalt kommen als Umschläge, die ID vom Browser (sie steckt in der AAD). Kein Index, keine
 * Tags und Links, kein Auszug – der Server kennt den Klartext nicht.
 */
function createVaultNote(userId: number, input: NoteInput): Note {
  const db = getDb()
  if (!input.id || !isValidId(input.id) || (input.title !== '' && input.title !== input.id)) throw vaultRequired()
  const titleEnc = assertEnvelope(input.titleEnc, MAX_VAULT_TITLE_ENVELOPE_LENGTH)
  const content = assertEnvelope(input.content, MAX_VAULT_ENVELOPE_LENGTH)
  const existing = db.prepare('SELECT user_id FROM notes WHERE id = ?').get(input.id) as { user_id: number } | undefined
  if (existing) {
    if (existing.user_id === userId) return getNote(userId, input.id)
    throw conflict('Diese ID ist bereits vergeben.')
  }
  const t = Date.now()
  db.prepare(
    `INSERT INTO notes (id, user_id, folder_id, title, title_enc, content, format, excerpt, pinned, vault, version,
       created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, 1, 1, ?, ?)`,
  ).run(input.id, userId, input.folderId, input.id, titleEnc, content, input.format ?? 'markdown', input.pinned ? 1 : 0, t, t)
  return getNote(userId, input.id)
}

type NotePatch = {
  title?: string
  /** Nur im Tresor: verschlüsselter Titel – zählt wie eine Änderung des Titels */
  titleEnc?: string
  folderId?: string | null
  content?: string
  /** Format wechseln – den umgewandelten Inhalt liefert der Browser in `content` mit */
  format?: NoteFormat
  pinned?: boolean
  /** Version, auf der die Änderung basiert (Konflikterkennung) */
  baseVersion?: number
  /** Bei Titel-Konflikt automatisch einen freien Namen wählen statt Fehler */
  autoRename?: boolean
  /**
   * Anlass, wenn es kein gewöhnliches Bearbeiten ist – der bisherige Stand wird dann immer im Verlauf gesichert:
   * conflict – die eigene Version überschreibt nach einem Konflikt den Server-Stand · restore – ein älterer Stand
   * wird wiederhergestellt
   */
  reason?: 'conflict' | 'restore'
}

export function updateNote(userId: number, id: string, patch: NotePatch): { note: Note; linksUpdated: number } {
  const db = getDb()
  const current = getNoteRow(userId, id)
  if (current.vault === 1) return { note: updateVaultNote(userId, current, patch), linksUpdated: 0 }
  if (patch.titleEnc !== undefined) throw vaultBoundary()
  const format = patch.format ?? current.format
  const contentChanged = (patch.content !== undefined && patch.content !== current.content) || format !== current.format
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
  if (contentChanged) checkContent(patch.content ?? current.content, format)
  if (folderChanged) assertFolder(userId, folderId)
  if (folderChanged && isVaultFolder(userId, folderId)) throw vaultBoundary()
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

  const text = contentChanged || bump ? noteText(format, content) : ''
  const snapshotReason: NoteVersionReason | null =
    patch.reason && bump ? patch.reason : format !== current.format ? 'format' : contentChanged ? 'edit' : null

  db.transaction(() => {
    if (snapshotReason) snapshotIfDue(db, current, snapshotReason)
    db.prepare(
      `UPDATE notes SET title = ?, folder_id = ?, content = ?, format = ?, excerpt = ?, pinned = ?,
         version = version + ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      title,
      folderId,
      content,
      format,
      contentChanged ? makeExcerpt(text) : current.excerpt,
      pinned,
      bump ? 1 : 0,
      bump || folderChanged ? Date.now() : current.updated_at,
      id,
      userId,
    )
    if (bump) indexNote(db, { id, user_id: userId, title, text })
    if (title !== current.title) linksUpdated = rewriteLinks(db, userId, id, current.title, title)
  })()
  return { note: getNote(userId, id), linksUpdated }
}

/** Tresor-Notiz ändern: nur Umschläge, verschieben nur innerhalb des Tresors, sonst wie updateNote */
function updateVaultNote(userId: number, current: NoteRow, patch: NotePatch): Note {
  const db = getDb()
  if (patch.title !== undefined && patch.title !== current.title) throw vaultRequired()
  if (patch.content !== undefined) assertEnvelope(patch.content, MAX_VAULT_ENVELOPE_LENGTH)
  const format = patch.format ?? current.format
  const titleEnc =
    patch.titleEnc !== undefined ? assertEnvelope(patch.titleEnc, MAX_VAULT_TITLE_ENVELOPE_LENGTH) : current.title_enc
  const contentChanged = (patch.content !== undefined && patch.content !== current.content) || format !== current.format
  const titleChanged = titleEnc !== current.title_enc
  const folderId = patch.folderId !== undefined ? patch.folderId : current.folder_id
  const folderChanged = folderId !== current.folder_id
  if (folderChanged && !isVaultFolder(userId, folderId)) throw vaultBoundary()
  if (patch.baseVersion !== undefined && patch.baseVersion !== current.version && (contentChanged || titleChanged)) {
    throw conflict('Die Notiz wurde inzwischen an anderer Stelle geändert.', 'version_conflict', {
      note: toNote(db, current),
    })
  }
  const bump = contentChanged || titleChanged
  const snapshotReason: NoteVersionReason | null =
    patch.reason && bump ? patch.reason : format !== current.format ? 'format' : contentChanged ? 'edit' : null
  const pinned = patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : current.pinned
  db.transaction(() => {
    if (snapshotReason) snapshotIfDue(db, current, snapshotReason)
    db.prepare(
      `UPDATE notes SET title_enc = ?, folder_id = ?, content = ?, format = ?, pinned = ?, version = version + ?,
         updated_at = ? WHERE id = ? AND user_id = ?`,
    ).run(
      titleEnc,
      folderId,
      patch.content ?? current.content,
      format,
      pinned,
      bump ? 1 : 0,
      bump || folderChanged ? Date.now() : current.updated_at,
      current.id,
      userId,
    )
  })()
  return getNote(userId, current.id)
}

/** Älteren Stand zurückholen – ein gewöhnliches Speichern, dabei wird der bisherige Stand gesichert ('restore') */
export function restoreVersion(userId: number, noteId: string, versionId: number) {
  const { title, titleEnc, format, content } = getVersion(userId, noteId, versionId)
  return updateNote(userId, noteId, {
    title,
    ...(titleEnc !== null ? { titleEnc } : {}),
    format,
    content,
    reason: 'restore',
    autoRename: true,
  })
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
  // Gibt es noch eine andere Notiz mit dem alten Titel, sind die Links mehrdeutig – dann nichts ändern. Verglichen wird
  // in JavaScript wie bei linkKey: SQLites lower() schreibt nur A–Z klein, „Übungen“ bliebe sonst unerkannt
  const others = db
    .prepare('SELECT title FROM notes WHERE user_id = ? AND deleted_at IS NULL AND vault = 0 AND id != ?')
    .all(userId, noteId) as { title: string }[]
  if (others.some((n) => linkKey(n.title) === key)) return 0

  // In formatiertem Text (HTML) steht „&“ als „&amp;“ – andere Sonderzeichen sind in Titeln nicht erlaubt
  const pattern = (title: string) =>
    new RegExp(`(!?\\[\\[)((?:[^[\\]|#\\n]*/)?)${escapeRegExp(title)}(\\.md)?(?=[\\]|#])`, 'gi')
  const forHtml = (s: string) => s.replace(/&/g, '&amp;')
  let count = 0
  const rewrite = (text: string, html: boolean) =>
    text.replace(pattern(html ? forHtml(oldTitle) : oldTitle), (_m, open: string, prefix: string) => {
      count++
      return `${open}${prefix}${html ? forHtml(newTitle) : newTitle}`
    })
  // Im Canvas: Wikilinks in Textkarten und Karten, die die Notiz selbst zeigen
  const rewriteCanvas = (json: string) =>
    mapCanvasNodes(json, (n) => {
      if (n.type === 'text') {
        const text = rewrite(n.text, false)
        return text === n.text ? n : { ...n, text }
      }
      if (n.type === 'file' && linkKey(n.file) === key) {
        count++
        return { ...n, file: newTitle }
      }
      return n
    })
  for (const src of sources) {
    const content = src.format === 'canvas' ? rewriteCanvas(src.content) : rewrite(src.content, src.format === 'richtext')
    if (content !== src.content) {
      const text = noteText(src.format, content)
      db.prepare(
        'UPDATE notes SET content = ?, excerpt = ?, version = version + 1, updated_at = ? WHERE id = ?',
      ).run(content, makeExcerpt(text), Date.now(), src.id)
      indexNote(db, { id: src.id, user_id: userId, title: src.title, text })
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
  if (row.vault === 1) {
    // Zurück in ihren Tresor-Ordner – gibt es den nicht mehr, in den Wurzelordner, ohne Index
    const folderId = isVaultFolder(userId, row.folder_id) ? row.folder_id : vaultRootId(userId)
    if (!folderId) throw notFound('Den Tresor dieser Notiz gibt es nicht mehr.')
    db.prepare('UPDATE notes SET deleted_at = NULL, folder_id = ?, updated_at = ? WHERE id = ?').run(
      folderId,
      Date.now(),
      id,
    )
    return getNote(userId, id)
  }
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
    indexNote(db, { id, user_id: userId, title, text: noteText(row.format, row.content) })
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

/**
 * Sammelaktion für mehrere Notizen in einer Transaktion. Fremde, unbekannte und für die Aktion unpassende IDs (z. B. auf
 * einem anderen Gerät schon gelöscht oder wiederhergestellt) werden übersprungen statt die Anfrage abzulehnen.
 * `delete` und `restore` wirken nur auf Notizen im Papierkorb, die übrigen nur auf nicht gelöschte.
 */
export function batchNotes(userId: number, action: NoteBatchAction, ids: string[]): NoteBatchResult {
  const db = getDb()
  const inTrash = action === 'delete' || action === 'restore'
  return db.transaction(() => {
    const found = db
      .prepare(
        `SELECT id FROM notes WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))
         AND deleted_at IS ${inTrash ? 'NOT NULL' : 'NULL'}`,
      )
      .all(userId, JSON.stringify(ids)) as { id: string }[]
    const known = new Set(found.map((r) => r.id))
    const matched = [...new Set(ids)].filter((id) => known.has(id))
    if (action === 'pin' || action === 'unpin') {
      // Wie beim Anheften einer einzelnen Notiz: weder Version noch Bearbeitungszeit ändern sich
      db.prepare(
        'UPDATE notes SET pinned = ? WHERE user_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))',
      ).run(action === 'pin' ? 1 : 0, userId, JSON.stringify(matched))
    } else {
      // Die Einzelfunktionen pflegen Suchindex und Links; ihre Transaktionen laufen hier als Savepoints. Beim
      // Wiederherstellen sehen sie die in dieser Anfrage schon vergebenen Titel (freie Namen bei Gleichstand)
      const apply = action === 'trash' ? trashNote : action === 'restore' ? restoreNote : deleteNotePermanently
      for (const id of matched) apply(userId, id)
    }
    return { ids: matched }
  })()
}

export function listTrash(userId: number): TrashedNote[] {
  purgeTrash(userId)
  const rows = getDb()
    .prepare(
      `SELECT id, title, folder_id AS folderId, deleted_at AS deletedAt, updated_at AS updatedAt, vault,
              title_enc AS titleEnc
       FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    )
    .all(userId) as (Omit<TrashedNote, 'vault'> & { vault: number })[]
  return rows.map((r) => ({ ...r, vault: r.vault === 1 }))
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

export function searchNotes(userId: number, query: string, limit = 50): SearchResult[] {
  const db = getDb()
  const { terms, tags } = parseSearch(query)
  if (tags.length === 0 && terms.length === 0) return []

  const tagFilter = tags
    .map(() => `AND EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND (t.tag = ? OR t.tag LIKE ? ESCAPE '\\'))`)
    .join(' ')
  const tagParams = tags.flatMap((t) => [t, t.replace(/[\\%_]/g, '\\$&') + '/%'])

  if (terms.length === 0) {
    const rows = db
      .prepare(
        `SELECT n.id, n.title, n.folder_id AS folderId, n.excerpt AS snippet, n.updated_at AS updatedAt
         FROM notes n WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.vault = 0 ${tagFilter}
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
         WHERE notes_fts MATCH ? AND f.user_id = ? AND n.deleted_at IS NULL AND n.vault = 0 ${tagFilter}
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
       WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.vault = 0 GROUP BY t.tag ORDER BY t.tag`,
    )
    .all(userId) as TagCount[]
}

export function listBacklinks(userId: number, id: string): { id: string; title: string; folderId: string | null }[] {
  const note = getNoteRow(userId, id)
  // Im Tresor gesperrt: Der Server kennt den Titel nicht, und Tresor-Notizen tauchen nirgends sonst auf
  if (note.vault === 1) return []
  return getDb()
    .prepare(
      `SELECT n.id, n.title, n.folder_id AS folderId FROM notes n JOIN note_links l ON l.note_id = n.id
       WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.vault = 0 AND l.target = ? AND n.id != ?
       ORDER BY n.updated_at DESC`,
    )
    .all(userId, linkKey(note.title), id) as { id: string; title: string; folderId: string | null }[]
}

/** Pfad eines Ordners als Array von Namen (für den Export – ohne Tresor, dessen Namen der Server nicht kennt). */
export function folderPathMap(userId: number): Map<string, string[]> {
  const folders = listFolders(userId).filter((f) => !f.vault)
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

// ---------------------------------------------------------------------------
// Über die Grenze des Tresors
// ---------------------------------------------------------------------------

function assertBaseVersion(db: Database.Database, current: NoteRow, baseVersion: number) {
  if (baseVersion !== current.version) {
    throw conflict('Die Notiz wurde inzwischen an anderer Stelle geändert.', 'version_conflict', {
      note: toNote(db, current),
    })
  }
}

/**
 * Notiz in den Tresor: Der Browser hat Titel und Inhalt mit der ID der Notiz verschlüsselt. Mit dem Klartext
 * verschwinden Verlauf, Freigaben, Suchindex, Tags und Links; Karteikarten werden gelöst oder auf Wunsch gelöscht.
 * secure_delete und der Checkpoint überschreiben den Klartext auch in der Datenbankdatei.
 */
export function moveNoteIntoVault(
  actor: Actor,
  id: string,
  input: { folderId: string; baseVersion: number; titleEnc: string; content: string; deleteCards: boolean },
): { note: Note; cards: number } {
  const userId = actor.user.id
  const db = getDb()
  const current = getNoteRow(userId, id)
  if (current.vault === 1) throw badRequest('Die Notiz liegt schon im Tresor.')
  if (!isVaultFolder(userId, input.folderId)) throw badRequest('Das Ziel liegt nicht im Tresor.')
  const titleEnc = assertEnvelope(input.titleEnc, MAX_VAULT_TITLE_ENVELOPE_LENGTH)
  const content = assertEnvelope(input.content, MAX_VAULT_ENVELOPE_LENGTH)
  assertBaseVersion(db, current, input.baseVersion)
  const cards = db.transaction(() => {
    db.prepare('DELETE FROM note_versions WHERE note_id = ? AND user_id = ?').run(id, userId)
    db.prepare('DELETE FROM shares WHERE note_id = ? AND user_id = ?').run(id, userId)
    unindexNote(db, id)
    db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(id)
    db.prepare('DELETE FROM note_links WHERE note_id = ?').run(id)
    const changed = input.deleteCards
      ? db.prepare('DELETE FROM cards WHERE note_id = ? AND user_id = ?').run(id, userId).changes
      : db.prepare('UPDATE cards SET note_id = NULL WHERE note_id = ? AND user_id = ?').run(id, userId).changes
    db.prepare(
      `UPDATE notes SET vault = 1, folder_id = ?, title = ?, title_enc = ?, content = ?, excerpt = '',
         version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).run(input.folderId, id, titleEnc, content, Date.now(), id, userId)
    return changed
  })()
  checkpoint()
  auditVaultMove(actor, id, 'in')
  return { note: getNote(userId, id), cards }
}

/**
 * Notiz aus dem Tresor: Der Browser hat entschlüsselt und schickt Klartext. Danach ist sie wieder durchsuchbar; der
 * verschlüsselte Verlauf entfällt, ein gleichnamiger Titel im Zielordner bekommt eine Nummer.
 */
export function moveNoteOutOfVault(
  actor: Actor,
  id: string,
  input: { folderId: string | null; baseVersion: number; title: string; content: string },
): { note: Note } {
  const userId = actor.user.id
  const db = getDb()
  const current = getNoteRow(userId, id)
  if (current.vault !== 1) throw badRequest('Die Notiz liegt nicht im Tresor.')
  assertFolder(userId, input.folderId)
  if (isVaultFolder(userId, input.folderId)) throw badRequest('Das Ziel liegt im Tresor.')
  const error = validateName(input.title.trim())
  if (error) throw badRequest(error)
  checkContent(input.content, current.format)
  assertBaseVersion(db, current, input.baseVersion)
  const title = uniqueName(input.title.trim(), noteTitlesInFolder(userId, input.folderId, id))
  const text = noteText(current.format, input.content)
  db.transaction(() => {
    db.prepare('DELETE FROM note_versions WHERE note_id = ? AND user_id = ?').run(id, userId)
    db.prepare(
      `UPDATE notes SET vault = 0, folder_id = ?, title = ?, title_enc = NULL, content = ?, excerpt = ?,
         version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).run(input.folderId, title, input.content, makeExcerpt(text), Date.now(), id, userId)
    indexNote(db, { id, user_id: userId, title, text })
  })()
  checkpoint()
  auditVaultMove(actor, id, 'out')
  return { note: getNote(userId, id) }
}
