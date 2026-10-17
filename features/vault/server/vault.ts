import 'server-only'
import { strToU8, unzipSync, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { getDb } from '@/shared/server/db'
import { getConfig } from '@/shared/server/config'
import { ApiError, badRequest } from '@/shared/server/http'
import { createFolder, createNote, folderPathMap, listFolders, MAX_NOTE_LENGTH } from '@/features/notes/server/notes'
import { listAttachments, readAttachmentData, saveAttachment } from '@/features/attachments/server/attachments'
import { getFlashcardData } from '@/features/flashcards/server/flashcards'
import { deckToMarkdown } from '@/features/flashcards/card-markdown'
import { exportIcs, importEvents, listEvents } from '@/features/calendar/server/events'
import { getCoursework } from '@/features/coursework/server/coursework'
import { tasksToMarkdown } from '@/features/coursework/tasks'
import { parseIcs } from '@/features/calendar/ics'
import { sanitizeFilename, sanitizeName, uniqueName } from '@/shared/lib/names'
import { htmlBody, htmlDocument } from '@/shared/lib/html'
import type { NoteFormat } from '@/features/notes/types'
import { canvasForExport, mapCanvasNodes, parseCanvas, type VaultIndex } from '@/features/canvas/canvas'
import { isMindmapMarkdown } from '@/features/mindmap/mindmap'
import { EXPORT_ATTACHMENT_FOLDER, buildVaultIndex, vaultNotePath } from '../paths'

/** Karteikarten-Stapel im Format des Obsidian-Plugins „Spaced Repetition“ */
const EXPORT_FLASHCARD_FOLDER = 'Karteikarten'
/** Aufgaben zum Wiederholen je Fach, Lösungen als eingeklappte Callouts */
const EXPORT_TASK_FOLDER = 'Aufgaben'
/** Alle Termine – lässt sich in jede Kalender-App importieren */
const EXPORT_CALENDAR_FILE = 'Kalender.ics'

type ExportEntry = { path: string; mtime: number; compress: boolean; data: () => Uint8Array }

const ATTACHMENT_DIR_RE = new RegExp(`(\\ssrc=["'])(?:\\.\\./)*(?:${encodeURIComponent(EXPORT_ATTACHMENT_FOLDER)}|${EXPORT_ATTACHMENT_FOLDER})/`, 'gi')

/** Bilder in formatiertem Text zeigen im Export auf den Ordner „Anhänge“ (relativ zur Datei) … */
function exportImagePaths(html: string, depth: number): string {
  const dir = '../'.repeat(depth) + encodeURIComponent(EXPORT_ATTACHMENT_FOLDER) + '/'
  return html.replace(/(\ssrc=["'])\/api\/files\//gi, `$1${dir}`)
}

/** … und nach dem Import wieder auf die Anhänge in Noted */
function importImagePaths(html: string): string {
  return html.replace(ATTACHMENT_DIR_RE, '$1/api/files/')
}

type ExportNote = { id: string; folder_id: string | null; title: string; content: string; format: NoteFormat; updated_at: number }
type IndexNote = Pick<ExportNote, 'folder_id' | 'title' | 'format'>

const foldersOf = (note: IndexNote, paths: Map<string, string[]>) => (note.folder_id ? (paths.get(note.folder_id) ?? []) : [])

/** Notizen in der Reihenfolge des Anlegens */
function indexFor(notes: IndexNote[], paths: Map<string, string[]>, userId: number): VaultIndex {
  return buildVaultIndex(
    notes.map((n) => ({ title: n.title, folders: foldersOf(n, paths), format: n.format })),
    listAttachments(userId).map((a) => a.filename),
  )
}

/** Pfade aller Notizen und Anhänge im Export – für die Dateikarten eines Canvas */
export function vaultIndex(userId: number): VaultIndex {
  const notes = getDb()
    .prepare('SELECT folder_id, title, format FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at')
    .all(userId) as IndexNote[]
  return indexFor(notes, folderPathMap(userId), userId)
}

function exportContent(n: ExportNote, depth: number, index: () => VaultIndex): string {
  if (n.format === 'richtext') return htmlDocument(n.title, exportImagePaths(n.content, depth))
  if (n.format === 'canvas') return canvasForExport(n.content, index())
  return n.content
}

/** Erstellt einen ZIP-Stream mit allen Notizen (Ordnerstruktur wie im Vault) und Anhängen. */
export function exportVaultStream(userId: number): ReadableStream<Uint8Array> {
  const paths = folderPathMap(userId)
  const notes = getDb()
    .prepare(
      `SELECT id, folder_id, title, content, format, updated_at FROM notes WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY created_at`,
    )
    .all(userId) as ExportNote[]
  let vault: VaultIndex | null = null
  const getVault = () => (vault ??= indexFor(notes, paths, userId))

  const entries: ExportEntry[] = notes.map((n) => {
    const folders = foldersOf(n, paths)
    return {
      path: vaultNotePath(folders, n.title, n.format),
      mtime: n.updated_at,
      compress: true,
      data: () => strToU8(exportContent(n, folders.length, getVault)),
    }
  })
  // Leere Ordner trotzdem anlegen
  const usedDirs = new Set(entries.map((e) => e.path.split('/').slice(0, -1).join('/')))
  for (const folderPath of paths.values()) {
    const p = folderPath.join('/')
    if (![...usedDirs].some((d) => d === p || d.startsWith(p + '/'))) {
      entries.push({ path: p + '/', mtime: Date.now(), compress: false, data: () => new Uint8Array(0) })
    }
  }
  const { decks, cards } = getFlashcardData(userId)
  // Dateinamen im Ordner „Karteikarten“ (auch von gleichnamigen Notizen) nicht doppelt vergeben
  const prefix = `${EXPORT_FLASHCARD_FOLDER}/`
  const taken = entries.filter((e) => e.path.startsWith(prefix)).map((e) => e.path.slice(prefix.length))
  for (const deck of decks) {
    const name = uniqueName(sanitizeName(deck.name), taken, '.md')
    taken.push(name)
    entries.push({
      path: prefix + name,
      mtime: deck.updatedAt,
      compress: true,
      data: () => strToU8(deckToMarkdown(deck, cards.filter((c) => c.deckId === deck.id))),
    })
  }
  const coursework = getCoursework(userId)
  const taskPrefix = `${EXPORT_TASK_FOLDER}/`
  const takenTasks = entries.filter((e) => e.path.startsWith(taskPrefix)).map((e) => e.path.slice(taskPrefix.length))
  for (const course of coursework.courses) {
    const tasks = coursework.tasks.filter((t) => t.courseId === course.id)
    if (tasks.length === 0) continue
    const name = uniqueName(sanitizeName(course.name), takenTasks, '.md')
    takenTasks.push(name)
    entries.push({
      path: taskPrefix + name,
      mtime: Math.max(...tasks.map((t) => t.updatedAt)),
      compress: true,
      data: () => strToU8(tasksToMarkdown(course.name, tasks)),
    })
  }
  const events = listEvents(userId)
  if (events.length > 0) {
    entries.push({
      path: EXPORT_CALENDAR_FILE,
      mtime: Math.max(...events.map((e) => e.updatedAt)),
      compress: true,
      data: () => strToU8(exportIcs(userId)),
    })
  }
  for (const att of listAttachments(userId)) {
    entries.push({
      path: `${EXPORT_ATTACHMENT_FOLDER}/${att.filename}`,
      mtime: att.createdAt,
      compress: /^(text\/|application\/(json|xml)|image\/(svg\+xml|bmp))/.test(att.mime),
      data: () => readAttachmentData(userId, att.id),
    })
  }

  let index = 0
  let zip: Zip
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (err) return controller.error(err)
        controller.enqueue(chunk)
        if (final) controller.close()
      })
    },
    pull() {
      if (index < entries.length) {
        const e = entries[index++]
        const file = e.compress ? new ZipDeflate(e.path, { level: 6 }) : new ZipPassThrough(e.path)
        file.mtime = e.mtime
        zip.add(file)
        file.push(e.data(), true)
      } else if (index === entries.length) {
        index++
        zip.end()
      }
    },
  })
}

export type ImportResult = { notes: number; attachments: number; folders: number; events: number; skipped: string[] }

const NOTE_EXT = /\.(md|markdown)$/i
/** HTML-Dateien werden zu formatiertem Text (so lässt sich ein Export wieder importieren) */
const HTML_EXT = /\.html?$/i
const CANVAS_EXT = /\.canvas$/i
const ICS_EXT = /\.ics$/i

function isHiddenPath(p: string) {
  return p.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX')
}

function decodeText(data: Uint8Array): string {
  return new TextDecoder('utf-8').decode(data).replace(/^﻿/, '')
}

/**
 * Dateikarten eines importierten Canvas: Obsidian speichert den Pfad im Vault („Ordner/Notiz.md“), Noted den Namen
 * wie in einem Wikilink – Notizen ohne Endung, Anhänge mit (sie landen beim Import alle unter ihrem Dateinamen).
 */
function importCanvasFiles(json: string): string {
  return mapCanvasNodes(json, (n) => {
    if (n.type !== 'file') return n
    const segments = n.file.split('/')
    const base = segments.pop() ?? n.file
    const note = NOTE_EXT.test(base) || CANVAS_EXT.test(base) || (HTML_EXT.test(base) && segments[0] !== EXPORT_ATTACHMENT_FOLDER)
    const file = note ? sanitizeName(base.replace(/\.(md|markdown|canvas|html?)$/i, '')) : sanitizeFilename(base)
    return file === n.file ? n : { ...n, file }
  })
}

/**
 * Importiert Markdown-, HTML- und Canvas-Dateien, Kalender (.ics), ZIP-Archive (z. B. ein Obsidian-Vault) und beliebige
 * Dateien (als Anhänge). Zeiten aus Kalendern werden in `timeZone` umgerechnet.
 */
export async function importFiles(
  userId: number,
  files: File[],
  targetFolderId: string | null,
  timeZone: string,
): Promise<ImportResult> {
  const { maxImportBytes, maxUploadBytes } = getConfig()
  const result: ImportResult = { notes: 0, attachments: 0, folders: 0, events: 0, skipped: [] }

  // Ordner-Cache: "parentId|name" -> id
  const folderCache = new Map<string, string>()
  for (const f of listFolders(userId)) folderCache.set(`${f.parentId ?? ''}|${f.name.toLowerCase()}`, f.id)

  const ensureFolder = (parentId: string | null, rawName: string): string => {
    const name = sanitizeName(rawName, 'Ordner')
    const key = `${parentId ?? ''}|${name.toLowerCase()}`
    const existing = folderCache.get(key)
    if (existing) return existing
    const folder = createFolder(userId, { name, parentId })
    folderCache.set(key, folder.id)
    result.folders++
    return folder.id
  }

  const existingAttachments = new Map(listAttachments(userId).map((a) => [a.filename.toLowerCase(), a.size]))

  const importNote = (folderId: string | null, filename: string, data: Uint8Array) => {
    if (HTML_EXT.test(filename)) {
      const title = sanitizeName(filename.replace(HTML_EXT, ''))
      createNote(userId, { title, folderId, format: 'richtext', content: importImagePaths(htmlBody(decodeText(data))) })
    } else if (CANVAS_EXT.test(filename)) {
      const content = decodeText(data)
      if (!parseCanvas(content)) throw badRequest('Kein gültiges Canvas.')
      const title = sanitizeName(filename.replace(CANVAS_EXT, ''))
      createNote(userId, { title, folderId, format: 'canvas', content: importCanvasFiles(content) })
    } else {
      const content = decodeText(data)
      const format = isMindmapMarkdown(content) ? 'mindmap' : 'markdown'
      createNote(userId, { title: sanitizeName(filename.replace(NOTE_EXT, '')), folderId, format, content })
    }
    result.notes++
  }
  // HTML im Ordner „Anhänge“ eines Exports bleibt ein Anhang
  const isNoteFile = (segments: string[], filename: string) =>
    NOTE_EXT.test(filename) || CANVAS_EXT.test(filename) || (HTML_EXT.test(filename) && segments[0] !== EXPORT_ATTACHMENT_FOLDER)
  // Ebenso eine .ics-Datei – sonst kommen ihre Termine in den Kalender
  const isCalendarFile = (segments: string[], filename: string) => ICS_EXT.test(filename) && segments[0] !== EXPORT_ATTACHMENT_FOLDER

  const importCalendar = (filename: string, data: Uint8Array) => {
    const parsed = parseIcs(decodeText(data), timeZone)
    result.events += importEvents(userId, parsed.events).created
    const n = parsed.skipped
    if (n > 0) result.skipped.push(`${filename} (${n} ${n === 1 ? 'Termin' : 'Termine'} nicht lesbar oder abgesagt)`)
  }

  const importAttachment = (filename: string, type: string | null, data: Uint8Array) => {
    if (data.byteLength > maxUploadBytes) {
      result.skipped.push(`${filename} (zu groß)`)
      return
    }
    if (data.byteLength === 0) return
    const clean = sanitizeFilename(filename)
    if (existingAttachments.get(clean.toLowerCase()) === data.byteLength) return // bereits vorhanden
    const att = saveAttachment(userId, { name: clean, type, data })
    existingAttachments.set(att.filename.toLowerCase(), att.size)
    result.attachments++
  }

  let total = 0
  for (const file of files) {
    total += file.size
    if (total > maxImportBytes) {
      throw new ApiError(413, 'too_large', `Der Import ist zu groß (max. ${Math.round(maxImportBytes / 1024 / 1024)} MB).`)
    }
    const data = new Uint8Array(await file.arrayBuffer())
    const name = file.name || 'Datei'

    if (/\.zip$/i.test(name)) {
      let entries: Record<string, Uint8Array>
      let declared = 0
      let count = 0
      try {
        // fflate reserviert für jeden Eintrag die angegebene Größe – daher vorher prüfen
        entries = unzipSync(data, {
          filter: (f) => {
            if (f.name.endsWith('/') || isHiddenPath(f.name)) return false
            const isNote = NOTE_EXT.test(f.name) || HTML_EXT.test(f.name) || CANVAS_EXT.test(f.name)
            const max = isNote ? MAX_NOTE_LENGTH * 4 : maxUploadBytes
            if (f.originalSize > max) {
              result.skipped.push(`${f.name} (zu groß)`)
              return false
            }
            count++
            declared += f.originalSize
            if (count > 10_000 || declared > maxImportBytes * 2) {
              throw new ApiError(413, 'too_large', 'Das ZIP-Archiv enthält zu viele oder zu große Dateien.')
            }
            return true
          },
        })
      } catch (err) {
        if (err instanceof ApiError) throw err
        throw badRequest(`„${name}“ ist kein gültiges ZIP-Archiv.`)
      }
      for (const [entryPath, entryData] of Object.entries(entries)) {
        const segments = entryPath.split('/').filter(Boolean)
        const filename = segments.pop()!
        try {
          if (isNoteFile(segments, filename)) {
            let folderId = targetFolderId
            for (const seg of segments) folderId = ensureFolder(folderId, seg)
            importNote(folderId, filename, entryData)
          } else if (isCalendarFile(segments, filename)) {
            importCalendar(entryPath, entryData)
          } else {
            importAttachment(filename, null, entryData)
          }
        } catch (err) {
          result.skipped.push(`${entryPath} (${err instanceof Error ? err.message : 'Fehler'})`)
        }
      }
    } else if (isNoteFile([], name)) {
      try {
        importNote(targetFolderId, name, data)
      } catch (err) {
        result.skipped.push(`${name} (${err instanceof Error ? err.message : 'Fehler'})`)
      }
    } else if (isCalendarFile([], name)) {
      try {
        importCalendar(name, data)
      } catch (err) {
        result.skipped.push(`${name} (${err instanceof Error ? err.message : 'Fehler'})`)
      }
    } else {
      try {
        importAttachment(name, file.type || null, data)
      } catch (err) {
        result.skipped.push(`${name} (${err instanceof Error ? err.message : 'Fehler'})`)
      }
    }
  }
  return result
}
