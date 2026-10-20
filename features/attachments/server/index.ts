import 'server-only'
// Volltextsuche in Anhängen: Text auslesen (extract.ts), seitenweise in attachments_fts ablegen und durchsuchen
import fs from 'node:fs'
import type Database from 'better-sqlite3'
import { getDb } from '@/shared/server/db'
import { badRequest, notFound } from '@/shared/server/http'
import { buildFtsQuery, parseSearch, SNIPPET_END, SNIPPET_START } from '@/shared/server/fts'
import { extractText, isSearchable, type Extracted } from './extract'
import { filePath } from './files'
import type { FileSearchResult, SearchIndexInfo } from '../types'

/** Pause zwischen zwei Dateien beim Nachholen des Bestands – der Server bleibt dabei ansprechbar */
const BACKFILL_PAUSE_MS = 250

type Job = { userId: number; background: boolean; done: Promise<void>; resolve: () => void }
type Queue = { jobs: Map<string, Job>; running: Promise<void> | null }

// Eine Warteschlange je Prozess – auch wenn Next.js das Modul für Routen und Serverstart getrennt lädt
const queue = ((globalThis as { __notedIndexQueue?: Queue }).__notedIndexQueue ??= { jobs: new Map(), running: null })

/**
 * Anhang im Hintergrund durchsuchbar machen: Gelesen wird erst nach der Antwort an den Browser, eine Datei nach der
 * anderen; neue Uploads vor dem Nachholen des Bestands.
 */
export function scheduleIndex(userId: number, attachmentId: string, opts: { background?: boolean } = {}): Promise<void> {
  const existing = queue.jobs.get(attachmentId)
  if (existing) return existing.done
  let resolve = () => {}
  const done = new Promise<void>((r) => (resolve = r))
  queue.jobs.set(attachmentId, { userId, background: !!opts.background, done, resolve })
  queue.running ??= run()
  return done
}

/** Wartet, bis alle vorgemerkten Anhänge gelesen sind (für Tests) */
export function indexPending(): Promise<void> {
  return queue.running ?? Promise.resolve()
}

async function run() {
  await new Promise((resolve) => setImmediate(resolve))
  for (;;) {
    const entries = [...queue.jobs.entries()]
    const next = entries.find(([, job]) => !job.background) ?? entries[0]
    if (!next) break
    const [id, job] = next
    try {
      await indexAttachment(job.userId, id)
    } catch (err) {
      console.error('[noted] Datei konnte nicht durchsucht werden', id, err)
    }
    queue.jobs.delete(id)
    job.resolve()
    if (job.background) await new Promise((resolve) => setTimeout(resolve, BACKFILL_PAUSE_MS))
  }
  queue.running = null
}

/** Beim Serverstart: Anhänge nachholen, die noch nie gelesen wurden (z. B. von vor dieser Funktion) */
export function indexMissing(): number {
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.user_id AS userId, a.mime FROM attachments a
       LEFT JOIN attachments_index i ON i.attachment_id = a.id
       WHERE i.attachment_id IS NULL ORDER BY a.created_at`,
    )
    .all() as { id: string; userId: number; mime: string }[]
  const missing = rows.filter((r) => isSearchable(r.mime))
  for (const r of missing) void scheduleIndex(r.userId, r.id, { background: true })
  return missing.length
}

/** Treffer eines Anhangs entfernen – beim Löschen und bevor er neu gelesen wird */
export function unindexAttachment(db: Database.Database, attachmentId: string) {
  db.prepare('DELETE FROM attachments_fts WHERE attachment_id = ?').run(attachmentId)
  db.prepare('DELETE FROM attachments_index WHERE attachment_id = ?').run(attachmentId)
}

/** Text auslesen und speichern. Fehler brechen nichts ab: Die Datei gilt dann als nicht durchsuchbar (failed). */
async function indexAttachment(userId: number, attachmentId: string) {
  const db = getDb()
  const row = db.prepare('SELECT mime FROM attachments WHERE id = ? AND user_id = ?').get(attachmentId, userId) as
    | { mime: string }
    | undefined
  if (!row || !isSearchable(row.mime)) return
  let result: Extracted | null = null
  try {
    result = await extractText(row.mime, fs.readFileSync(filePath(userId, attachmentId)))
  } catch (err) {
    console.error('[noted] Datei konnte nicht durchsucht werden', attachmentId, err)
  }
  db.transaction(() => {
    // Während des Lesens gelöscht?
    if (!db.prepare('SELECT 1 FROM attachments WHERE id = ? AND user_id = ?').get(attachmentId, userId)) return
    unindexAttachment(db, attachmentId)
    const insert = db.prepare('INSERT INTO attachments_fts (attachment_id, user_id, page, content) VALUES (?, ?, ?, ?)')
    if (result && 'pages' in result) {
      result.pages.forEach((text, i) => {
        if (text.trim()) insert.run(attachmentId, userId, i + 1, text)
      })
    }
    const [state, pages, reason] = !result
      ? ['failed', 0, null]
      : 'pages' in result
        ? ['done', result.pages.length, result.truncated]
        : ['skipped', 0, result.skipped]
    db.prepare(
      'INSERT INTO attachments_index (attachment_id, state, pages, reason, indexed_at) VALUES (?, ?, ?, ?, ?)',
    ).run(attachmentId, state, pages, reason, Date.now())
  })()
}

/** „Erneut lesen“ – sofort, ohne auf das Nachholen des Bestands zu warten */
export async function reindexAttachment(userId: number, attachmentId: string): Promise<SearchIndexInfo> {
  const row = getDb().prepare('SELECT mime FROM attachments WHERE id = ? AND user_id = ?').get(attachmentId, userId) as
    | { mime: string }
    | undefined
  if (!row) throw notFound('Datei nicht gefunden.')
  if (!isSearchable(row.mime)) throw badRequest('Nur PDFs und Textdateien lassen sich durchsuchen.')
  await indexAttachment(userId, attachmentId)
  return searchIndexInfo(userId).get(attachmentId) ?? { state: 'pending', pages: 0, reason: null }
}

/** Stand der Volltextsuche je Datei eines Nutzers (nur durchsuchbare Dateitypen) */
export function searchIndexInfo(userId: number): Map<string, SearchIndexInfo> {
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.mime, i.state, i.pages, i.reason FROM attachments a
       LEFT JOIN attachments_index i ON i.attachment_id = a.id WHERE a.user_id = ?`,
    )
    .all(userId) as { id: string; mime: string; state: SearchIndexInfo['state'] | null; pages: number | null; reason: string | null }[]
  const map = new Map<string, SearchIndexInfo>()
  for (const r of rows) {
    if (!isSearchable(r.mime)) continue
    map.set(r.id, r.state ? { state: r.state, pages: r.pages ?? 0, reason: r.reason } : { state: 'pending', pages: 0, reason: null })
  }
  return map
}

/** Volltextsuche in den Anhängen – ein Treffer je Seite, Markierung im Ausschnitt wie bei Notizen */
export function searchAttachments(userId: number, query: string, limit = 20): FileSearchResult[] {
  const { terms } = parseSearch(query)
  if (terms.length === 0) return []
  try {
    return getDb()
      .prepare(
        `SELECT a.id, a.filename, a.mime, f.page,
                snippet(attachments_fts, 3, '${SNIPPET_START}', '${SNIPPET_END}', '…', 14) AS snippet
         FROM attachments_fts f JOIN attachments a ON a.id = f.attachment_id
         WHERE attachments_fts MATCH ? AND f.user_id = ? AND a.user_id = ?
         ORDER BY bm25(attachments_fts) LIMIT ?`,
      )
      .all(buildFtsQuery(terms), userId, userId, limit) as FileSearchResult[]
  } catch (err) {
    console.warn('[noted] Suchanfrage in Dateien fehlgeschlagen', err)
    return []
  }
}
