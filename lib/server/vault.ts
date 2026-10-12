import 'server-only'
import { strToU8, unzipSync, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { getDb } from './db'
import { getConfig } from './config'
import { ApiError, badRequest } from './http'
import { createFolder, createNote, folderPathMap, listFolders, MAX_NOTE_LENGTH } from './notes'
import { listAttachments, readAttachmentData, saveAttachment } from './attachments'
import { sanitizeFilename, sanitizeName } from '@/lib/shared/names'

export const EXPORT_ATTACHMENT_FOLDER = 'Anhänge'

type ExportEntry = { path: string; mtime: number; compress: boolean; data: () => Uint8Array }

/** Erstellt einen ZIP-Stream mit allen Notizen (Ordnerstruktur wie im Vault) und Anhängen. */
export function exportVaultStream(userId: number): ReadableStream<Uint8Array> {
  const paths = folderPathMap(userId)
  const notes = getDb()
    .prepare('SELECT id, folder_id, title, content, updated_at FROM notes WHERE user_id = ? AND deleted_at IS NULL')
    .all(userId) as { id: string; folder_id: string | null; title: string; content: string; updated_at: number }[]

  const entries: ExportEntry[] = notes.map((n) => ({
    path: [...(n.folder_id ? (paths.get(n.folder_id) ?? []) : []), `${n.title}.md`].join('/'),
    mtime: n.updated_at,
    compress: true,
    data: () => strToU8(n.content),
  }))
  // Leere Ordner trotzdem anlegen
  const usedDirs = new Set(entries.map((e) => e.path.split('/').slice(0, -1).join('/')))
  for (const folderPath of paths.values()) {
    const p = folderPath.join('/')
    if (![...usedDirs].some((d) => d === p || d.startsWith(p + '/'))) {
      entries.push({ path: p + '/', mtime: Date.now(), compress: false, data: () => new Uint8Array(0) })
    }
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

export type ImportResult = { notes: number; attachments: number; folders: number; skipped: string[] }

const NOTE_EXT = /\.(md|markdown)$/i

function isHiddenPath(p: string) {
  return p.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX')
}

function decodeText(data: Uint8Array): string {
  return new TextDecoder('utf-8').decode(data).replace(/^﻿/, '')
}

/**
 * Importiert Markdown-Dateien, ZIP-Archive (z. B. ein Obsidian-Vault) und beliebige Dateien (als Anhänge).
 */
export async function importFiles(userId: number, files: File[], targetFolderId: string | null): Promise<ImportResult> {
  const { maxImportBytes, maxUploadBytes } = getConfig()
  const result: ImportResult = { notes: 0, attachments: 0, folders: 0, skipped: [] }

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
    const title = sanitizeName(filename.replace(NOTE_EXT, ''))
    createNote(userId, { title, folderId, content: decodeText(data) })
    result.notes++
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
            const max = NOTE_EXT.test(f.name) ? MAX_NOTE_LENGTH * 4 : maxUploadBytes
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
          if (NOTE_EXT.test(filename)) {
            let folderId = targetFolderId
            for (const seg of segments) folderId = ensureFolder(folderId, seg)
            importNote(folderId, filename, entryData)
          } else {
            importAttachment(filename, null, entryData)
          }
        } catch (err) {
          result.skipped.push(`${entryPath} (${err instanceof Error ? err.message : 'Fehler'})`)
        }
      }
    } else if (NOTE_EXT.test(name)) {
      try {
        importNote(targetFolderId, name, data)
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
