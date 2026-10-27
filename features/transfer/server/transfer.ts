import 'server-only'
import { strToU8, unzipSync } from 'fflate'
import { getDb } from '@/shared/server/db'
import { getConfig } from '@/shared/server/config'
import { zipBytes, zipStream, type ZipEntry } from '@/shared/server/zip'
import { ApiError, badRequest } from '@/shared/server/http'
import { createFolder, createNote, folderPathMap, listFolders, MAX_NOTE_LENGTH } from '@/features/notes/server/notes'
import { listAttachments, readAttachmentData, saveAttachment } from '@/features/attachments/server/attachments'
import { getFlashcardData } from '@/features/flashcards/server/flashcards'
import { deckToMarkdown } from '@/features/flashcards/card-markdown'
import { DECK_PACKAGE_EXT } from '@/features/flashcards/deck-package'
import { deckPackage, importDeckPackage } from '@/features/flashcards/server/deck-package'
import { exportIcs, importEvents, listEvents } from '@/features/calendar/server/events'
import { parseIcs } from '@/features/calendar/ics'
import { sanitizeFilename, sanitizeName, uniqueName } from '@/shared/lib/names'
import { htmlBody, htmlDocument } from '@/shared/lib/html'
import type { NoteFormat } from '@/features/notes/types'
import { canvasForExport, mapCanvasNodes, parseCanvas, type ExportIndex } from '@/features/canvas/canvas'
import { isMindmapMarkdown } from '@/features/mindmap/mindmap'
import { annotationsByAttachment, annotationsFile, importAnnotations, readAnnotationsFile } from '@/features/pdf/server/annotations'
import { annotationsMarkdown } from '@/features/pdf/geometry'
import { EXPORT_ATTACHMENT_FOLDER, buildExportIndex, exportNotePath } from '../paths'
import { VAULT_EXPORT_FILE, vaultExport } from '@/features/vault/server/export'
import { isVaultFolder } from '@/features/vault/server/vault'

/** Karteikarten-Stapel als Markdown (Frage::Antwort, siehe deckToMarkdown) und verlustfrei als .noted-deck.zip */
const EXPORT_FLASHCARD_FOLDER = 'Karteikarten'
/** Alle Termine – lässt sich in jede Kalender-App importieren */
const EXPORT_CALENDAR_FILE = 'Kalender.ics'
/** Anmerkungen eines PDFs liegen im Export neben der Datei: zum Lesen (der Import übergeht sie) … */
const ANNOTATIONS_SUFFIX = '.anmerkungen.md'
/** … und mit Positionen und Farben, zum Wiederherstellen beim Import */
const ANNOTATIONS_FILE_SUFFIX = '.anmerkungen.json'

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
function indexFor(notes: IndexNote[], paths: Map<string, string[]>, userId: number): ExportIndex {
  return buildExportIndex(
    notes.map((n) => ({ title: n.title, folders: foldersOf(n, paths), format: n.format })),
    listAttachments(userId).map((a) => a.filename),
  )
}

/** Pfade aller Notizen und Anhänge im Export – für die Dateikarten eines Canvas */
export function exportIndex(userId: number): ExportIndex {
  const notes = getDb()
    .prepare(
      `SELECT folder_id, title, format FROM notes WHERE user_id = ? AND deleted_at IS NULL AND vault = 0
       ORDER BY created_at`,
    )
    .all(userId) as IndexNote[]
  return indexFor(notes, folderPathMap(userId), userId)
}

function exportContent(n: ExportNote, depth: number, index: () => ExportIndex): string {
  if (n.format === 'richtext') return htmlDocument(n.title, exportImagePaths(n.content, depth))
  if (n.format === 'canvas') return canvasForExport(n.content, index())
  return n.content
}

/** Erstellt einen ZIP-Stream mit allen Notizen (in ihrer Ordnerstruktur) und Anhängen. */
export function exportZipStream(userId: number): ReadableStream<Uint8Array> {
  const paths = folderPathMap(userId)
  const notes = getDb()
    .prepare(
      `SELECT id, folder_id, title, content, format, updated_at FROM notes
       WHERE user_id = ? AND deleted_at IS NULL AND vault = 0 ORDER BY created_at`,
    )
    .all(userId) as ExportNote[]
  let pathIndex: ExportIndex | null = null
  const getPathIndex = () => (pathIndex ??= indexFor(notes, paths, userId))

  const entries: ZipEntry[] = notes.map((n) => {
    const folders = foldersOf(n, paths)
    return {
      path: exportNotePath(folders, n.title, n.format),
      mtime: n.updated_at,
      compress: true,
      data: () => strToU8(exportContent(n, folders.length, getPathIndex)),
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
  // Der Tresor nur verschlüsselt, als eine Datei – seine Notizen und Ordner nicht einzeln
  const vault = vaultExport(userId)
  if (vault) {
    entries.push({ path: VAULT_EXPORT_FILE, mtime: vault.updatedAt, compress: true, data: () => strToU8(vault.json) })
  }
  const { decks, cards } = getFlashcardData(userId)
  // Dateinamen im Ordner „Karteikarten“ (auch von gleichnamigen Notizen) nicht doppelt vergeben
  const prefix = `${EXPORT_FLASHCARD_FOLDER}/`
  const taken = entries.filter((e) => e.path.startsWith(prefix)).map((e) => e.path.slice(prefix.length))
  for (const deck of decks) {
    const name = uniqueName(sanitizeName(deck.name), taken, '.md')
    taken.push(name)
    const deckCards = cards.filter((c) => c.deckId === deck.id)
    entries.push({
      path: prefix + name,
      mtime: deck.updatedAt,
      compress: true,
      data: () => strToU8(deckToMarkdown(deck, deckCards)),
    })
    // Gleicher Name wie die .md – daran erkennt der Import, dass beide zum selben Stapel gehören
    entries.push({
      path: prefix + name.replace(/\.md$/, DECK_PACKAGE_EXT),
      mtime: deck.updatedAt,
      compress: false,
      data: () => zipBytes(deckPackage(userId, deck, deckCards)),
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
  const attachments = listAttachments(userId)
  const annotations = annotationsByAttachment(userId)
  const attachmentNames = attachments.map((a) => a.filename)
  for (const att of attachments) {
    entries.push({
      path: `${EXPORT_ATTACHMENT_FOLDER}/${att.filename}`,
      mtime: att.createdAt,
      compress: /^(text\/|application\/(json|xml)|image\/(svg\+xml|bmp))/.test(att.mime),
      data: () => readAttachmentData(userId, att.id),
    })
    // Markierungen eines PDFs daneben als lesbares Markdown („Skript.pdf.anmerkungen.md“) und für den Import als JSON
    const list = annotations.get(att.id)
    if (!list) continue
    const mtime = Math.max(...list.map((a) => a.updatedAt))
    const name = uniqueName(att.filename, attachmentNames, ANNOTATIONS_SUFFIX)
    const file = uniqueName(att.filename, attachmentNames, ANNOTATIONS_FILE_SUFFIX)
    attachmentNames.push(name, file)
    entries.push(
      {
        path: `${EXPORT_ATTACHMENT_FOLDER}/${name}`,
        mtime,
        compress: true,
        data: () => strToU8(annotationsMarkdown(att.filename, list)),
      },
      {
        path: `${EXPORT_ATTACHMENT_FOLDER}/${file}`,
        mtime,
        compress: true,
        data: () => strToU8(annotationsFile(att.filename, list)),
      },
    )
  }

  return zipStream(entries)
}

type ImportResult = {
  notes: number
  attachments: number
  folders: number
  events: number
  /** Neue Karteikarten-Stapel und ihre Karten (aus .noted-deck.zip) */
  decks: number
  cards: number
  /** Übernommene Anmerkungen in PDFs (aus .anmerkungen.json eines Exports) */
  annotations: number
  skipped: string[]
}

const NOTE_EXT = /\.(md|markdown)$/i
/** HTML-Dateien werden zu formatiertem Text (so lässt sich ein Export wieder importieren) */
const HTML_EXT = /\.html?$/i
const CANVAS_EXT = /\.canvas$/i
const ICS_EXT = /\.ics$/i
/** Verschlüsselter Tresor aus einem Export – den Import in den Tresor gibt es noch nicht */
const VAULT_EXT = /\.noted-vault$/i
const isDeckPackage = (name: string) => name.toLowerCase().endsWith(DECK_PACKAGE_EXT)

/** Anmerkungen zu einem PDF aus einem Export von Noted („Anhänge/Skript.pdf.anmerkungen.md“ neben „Skript.pdf“) */
function isAnnotationsFile(entryPath: string, entries: Record<string, Uint8Array>) {
  if (!entryPath.startsWith(`${EXPORT_ATTACHMENT_FOLDER}/`) || !entryPath.endsWith(ANNOTATIONS_SUFFIX)) return false
  return Object.hasOwn(entries, entryPath.slice(0, -ANNOTATIONS_SUFFIX.length))
}

/** Anmerkungen mit Positionen aus einem Export von Noted („Anhänge/Skript.pdf.anmerkungen.json“) */
function isAnnotationsDataFile(segments: string[], filename: string) {
  return segments[0] === EXPORT_ATTACHMENT_FOLDER && filename.toLowerCase().endsWith(ANNOTATIONS_FILE_SUFFIX)
}

function isHiddenPath(p: string) {
  return p.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX')
}

function decodeText(data: Uint8Array): string {
  return new TextDecoder('utf-8').decode(data).replace(/^﻿/, '')
}

/**
 * Dateikarten eines importierten Canvas: In der Datei steht der Pfad im Archiv („Ordner/Notiz.md“), Noted speichert
 * den Namen wie in einem Wikilink – Notizen ohne Endung, Anhänge mit (sie landen beim Import alle unter ihrem Dateinamen).
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
 * Importiert Markdown-, HTML- und Canvas-Dateien, Kalender (.ics), Karteikarten-Stapel (.noted-deck.zip), ZIP-Archive
 * (z. B. ein Export aus Noted) und beliebige Dateien (als Anhänge). Zeiten aus Kalendern werden in `timeZone` umgerechnet.
 */
export async function importFiles(
  userId: number,
  files: File[],
  targetFolderId: string | null,
  timeZone: string,
): Promise<ImportResult> {
  const { maxImportBytes, maxUploadBytes } = getConfig()
  const result: ImportResult = { notes: 0, attachments: 0, folders: 0, events: 0, decks: 0, cards: 0, annotations: 0, skipped: [] }
  // Im Tresor wird nur verschlüsselt gespeichert – das kann der Server nicht
  if (isVaultFolder(userId, targetFolderId)) throw badRequest('In den Tresor lässt sich noch nichts importieren.')

  // Ordner-Cache: "parentId|name" -> id – ohne Tresor; ein Ordner „Tresor“ im Archiv wird ein eigener („Tresor 1“)
  const folderCache = new Map<string, string>()
  const vaultNames = new Map<string, string[]>()
  for (const f of listFolders(userId)) {
    if (!f.vault) folderCache.set(`${f.parentId ?? ''}|${f.name.toLowerCase()}`, f.id)
    else vaultNames.set(f.parentId ?? '', [...(vaultNames.get(f.parentId ?? '') ?? []), f.name])
  }

  const ensureFolder = (parentId: string | null, rawName: string): string => {
    const clean = sanitizeName(rawName, 'Ordner')
    const name = uniqueName(clean, vaultNames.get(parentId ?? '') ?? [])
    const key = `${parentId ?? ''}|${clean.toLowerCase()}`
    const existing = folderCache.get(key)
    if (existing) return existing
    const folder = createFolder(userId, { name, parentId })
    folderCache.set(key, folder.id)
    result.folders++
    return folder.id
  }

  const existingAttachments = new Map(listAttachments(userId).map((a) => [a.filename.toLowerCase(), a]))

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

  /** Liefert den Anhang, in dem die Datei jetzt liegt – neu, umbenannt oder schon vorhanden */
  const importAttachment = (filename: string, type: string | null, data: Uint8Array): string | null => {
    if (data.byteLength > maxUploadBytes) {
      result.skipped.push(`${filename} (zu groß)`)
      return null
    }
    if (data.byteLength === 0) return null
    const clean = sanitizeFilename(filename)
    const existing = existingAttachments.get(clean.toLowerCase())
    if (existing?.size === data.byteLength) return existing.id // bereits vorhanden
    const att = saveAttachment(userId, { name: clean, type, data })
    existingAttachments.set(att.filename.toLowerCase(), att)
    result.attachments++
    return att.id
  }

  const importDeck = (data: Uint8Array) => {
    const r = importDeckPackage(userId, data)
    if (r.deck.created) result.decks++
    result.cards += r.cards
    result.attachments += r.media
    for (const s of r.skipped) result.skipped.push(`${r.deck.name}: ${s}`)
    // Dateien des Stapels sind jetzt vorhanden – nicht noch einmal aus „Anhänge“ übernehmen
    for (const a of listAttachments(userId)) existingAttachments.set(a.filename.toLowerCase(), a)
  }

  let total = 0
  for (const file of files) {
    total += file.size
    if (total > maxImportBytes) {
      throw new ApiError(413, 'too_large', `Der Import ist zu groß (max. ${Math.round(maxImportBytes / 1024 / 1024)} MB).`)
    }
    const data = new Uint8Array(await file.arrayBuffer())
    const name = file.name || 'Datei'

    if (VAULT_EXT.test(name)) {
      result.skipped.push(`${name} (der Tresor lässt sich noch nicht importieren)`)
    } else if (isDeckPackage(name)) {
      try {
        importDeck(data)
      } catch (err) {
        result.skipped.push(`${name} (${err instanceof Error ? err.message : 'Fehler'})`)
      }
    } else if (/\.zip$/i.test(name)) {
      let entries: Record<string, Uint8Array>
      let declared = 0
      let count = 0
      try {
        // fflate reserviert für jeden Eintrag die angegebene Größe – daher vorher prüfen
        entries = unzipSync(data, {
          filter: (f) => {
            if (f.name.endsWith('/') || isHiddenPath(f.name)) return false
            const isNote = NOTE_EXT.test(f.name) || HTML_EXT.test(f.name) || CANVAS_EXT.test(f.name)
            // Ein Stapel mit seinen Bildern darf so groß sein wie der Import selbst
            const max = isNote ? MAX_NOTE_LENGTH * 4 : isDeckPackage(f.name) ? maxImportBytes : maxUploadBytes
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
      // Gibt es einen Stapel als Paket und als Markdown (Export aus Noted), zählt nur das verlustfreie Paket
      const packages = new Set(Object.keys(entries).filter((p) => isDeckPackage(p) && !p.startsWith(`${EXPORT_ATTACHMENT_FOLDER}/`)))
      // Anhang je Pfad im Archiv – Anmerkungen kommen erst danach dazu, die Reihenfolge im ZIP ist beliebig
      const attachmentAt = new Map<string, string>()
      const annotationFiles: [string, Uint8Array][] = []
      for (const [entryPath, entryData] of Object.entries(entries)) {
        const segments = entryPath.split('/').filter(Boolean)
        const filename = segments.pop()!
        try {
          if (NOTE_EXT.test(entryPath) && packages.has(entryPath.replace(NOTE_EXT, DECK_PACKAGE_EXT))) continue
          if (isAnnotationsFile(entryPath, entries)) continue
          if (isAnnotationsDataFile(segments, filename)) {
            annotationFiles.push([entryPath, entryData])
            continue
          }
          if (VAULT_EXT.test(filename)) {
            result.skipped.push(`${entryPath} (der Tresor lässt sich noch nicht importieren)`)
            continue
          }
          if (isDeckPackage(filename) && segments[0] !== EXPORT_ATTACHMENT_FOLDER) {
            importDeck(entryData)
          } else if (isNoteFile(segments, filename)) {
            let folderId = targetFolderId
            for (const seg of segments) folderId = ensureFolder(folderId, seg)
            importNote(folderId, filename, entryData)
          } else if (isCalendarFile(segments, filename)) {
            importCalendar(entryPath, entryData)
          } else {
            const id = importAttachment(filename, null, entryData)
            if (id) attachmentAt.set(entryPath, id)
          }
        } catch (err) {
          result.skipped.push(`${entryPath} (${err instanceof Error ? err.message : 'Fehler'})`)
        }
      }
      for (const [entryPath, entryData] of annotationFiles) {
        try {
          const file = readAnnotationsFile(entryData)
          // Eine andere JSON-Datei dieses Namens bleibt ein gewöhnlicher Anhang
          if (!file) {
            importAttachment(entryPath.split('/').pop()!, null, entryData)
            continue
          }
          // Das PDF liegt im selben Ordner des Archivs – unter dem Namen, den es beim Export hatte
          const pdf = attachmentAt.get(entryPath.slice(0, entryPath.lastIndexOf('/') + 1) + file.file)
          if (!pdf) {
            result.skipped.push(`${entryPath} (das PDF dazu fehlt im Archiv)`)
            continue
          }
          result.annotations += importAnnotations(userId, pdf, file.annotations)
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
