import 'server-only'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { getDb } from '@/shared/server/db'
import { notFound } from '@/shared/server/http'
import type { NoteFormat, NoteVersion, NoteVersionReason, NoteVersionWithContent } from '../types'

/** Beim Tippen höchstens ein gesicherter Stand je 10 Minuten – sonst entstünde pro Autosave ein Eintrag */
const EDIT_SNAPSHOT_INTERVAL = 10 * 60_000
export const MAX_VERSIONS_PER_NOTE = 50
export const VERSION_MAX_AGE = 90 * 86_400_000

type CurrentNote = {
  id: string
  user_id: number
  version: number
  title: string
  title_enc: string | null
  format: NoteFormat
  content: string
  created_at: number
}

type VersionRow = {
  id: number
  version: number
  title: string
  title_enc: string | null
  format: NoteFormat
  reason: NoteVersionReason
  created_at: number
  size: number
}

const toVersion = (r: VersionRow): NoteVersion => ({
  id: r.id,
  version: r.version,
  title: r.title,
  titleEnc: r.title_enc,
  format: r.format,
  reason: r.reason,
  createdAt: r.created_at,
  size: r.size,
})

/**
 * Sichert den bisherigen Stand einer Notiz, bevor er überschrieben wird. Beim Bearbeiten ('edit') nur, wenn die letzte
 * Sicherung – oder bei einer frisch angelegten Notiz das Anlegen – mehr als 10 Minuten zurückliegt; so landen keine
 * halb getippten Anfänge im Verlauf. Läuft innerhalb der Transaktion von updateNote.
 */
export function snapshotIfDue(
  db: Database.Database,
  note: CurrentNote,
  reason: NoteVersionReason,
  now = Date.now(),
): boolean {
  if (reason === 'edit') {
    const last = db
      .prepare('SELECT MAX(created_at) AS t FROM note_versions WHERE note_id = ? AND user_id = ?')
      .get(note.id, note.user_id) as { t: number | null }
    if (now - (last.t ?? note.created_at) < EDIT_SNAPSHOT_INTERVAL) return false
  }
  saveSnapshot(db, note, reason, now)
  return true
}

/** Stand sofort sichern – auch beim Bearbeiten, z. B. bevor der Server viele Notizen auf einmal ändert */
export function saveSnapshot(db: Database.Database, note: CurrentNote, reason: NoteVersionReason, now = Date.now()) {
  db.prepare(
    `INSERT INTO note_versions (note_id, user_id, version, title, title_enc, format, content, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(note.id, note.user_id, note.version, note.title, note.title_enc, note.format, note.content, reason, now)
  db.prepare(
    `DELETE FROM note_versions WHERE note_id = ? AND user_id = ? AND (created_at < ? OR id NOT IN (
       SELECT id FROM note_versions WHERE note_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
     ))`,
  ).run(note.id, note.user_id, now - VERSION_MAX_AGE, note.id, note.user_id, MAX_VERSIONS_PER_NOTE)
}

const VERSION_GONE = 'Dieser Stand ist nicht mehr vorhanden.'
const versionIdSchema = z.string().regex(/^[1-9]\d{0,14}$/).transform(Number)

/** Nummer eines Stands aus der URL – ungültige Angaben verhalten sich wie ein nicht vorhandener Stand */
export function parseVersionId(param: string): number {
  const parsed = versionIdSchema.safeParse(param)
  if (!parsed.success) throw notFound(VERSION_GONE)
  return parsed.data
}

function assertNote(userId: number, noteId: string) {
  const found = getDb()
    .prepare('SELECT 1 FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(noteId, userId)
  if (!found) throw notFound('Notiz nicht gefunden.')
}

const VERSION_COLUMNS =
  'id, version, title, title_enc, format, reason, created_at, length(CAST(content AS BLOB)) AS size'

/** Gesicherte Stände einer Notiz, neueste zuerst (ohne Inhalt) */
export function listVersions(userId: number, noteId: string): NoteVersion[] {
  assertNote(userId, noteId)
  const rows = getDb()
    .prepare(
      `SELECT ${VERSION_COLUMNS} FROM note_versions WHERE note_id = ? AND user_id = ?
       ORDER BY created_at DESC, id DESC`,
    )
    .all(noteId, userId) as VersionRow[]
  return rows.map(toVersion)
}

export function getVersion(userId: number, noteId: string, versionId: number): NoteVersionWithContent {
  assertNote(userId, noteId)
  const row = getDb()
    .prepare(`SELECT ${VERSION_COLUMNS}, content FROM note_versions WHERE id = ? AND note_id = ? AND user_id = ?`)
    .get(versionId, noteId, userId) as (VersionRow & { content: string }) | undefined
  if (!row) throw notFound(VERSION_GONE)
  return { ...toVersion(row), content: row.content }
}

/** Stände älter als 90 Tage und über der Höchstzahl je Notiz entfernen (regelmäßiges Aufräumen) */
export function purgeVersions(now = Date.now()) {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM note_versions WHERE created_at < ?').run(now - VERSION_MAX_AGE)
    db.prepare(
      `DELETE FROM note_versions WHERE id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY note_id ORDER BY created_at DESC, id DESC) AS n FROM note_versions
         ) WHERE n > ?
       )`,
    ).run(MAX_VERSIONS_PER_NOTE)
  })()
}
