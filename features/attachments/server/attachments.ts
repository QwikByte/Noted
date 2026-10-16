import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { getDb } from '@/shared/server/db'
import { getConfig } from '@/shared/server/config'
import { ApiError, badRequest, notFound } from '@/shared/server/http'
import { uuid } from '@/shared/server/crypto'
import { sanitizeFilename, splitExtension, uniqueName } from '@/shared/lib/names'
import type { Attachment } from '../types'

type AttachmentRow = {
  id: string
  user_id: number
  filename: string
  mime: string
  size: number
  created_at: number
}

const toAttachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  filename: r.filename,
  mime: r.mime,
  size: r.size,
  createdAt: r.created_at,
})

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/webm': '.webm',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'text/plain': '.txt',
}

/** Typen, die der Browser direkt anzeigen darf. Alles andere wird als Download ausgeliefert. */
const INLINE_MIME = /^(image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+|text\/plain)$/

/** MIME-Typ nur anhand bekannter Endungen – Angaben des Browsers werden nicht übernommen. */
function guessMime(filename: string): string {
  const ext = splitExtension(filename).ext.toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function userDir(userId: number) {
  return path.join(/*turbopackIgnore: true*/ getConfig().attachmentsDir, String(userId))
}

function filePath(userId: number, id: string) {
  return path.join(/*turbopackIgnore: true*/ userDir(userId), id)
}

export function listAttachments(userId: number): Attachment[] {
  return (
    getDb()
      .prepare('SELECT * FROM attachments WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as AttachmentRow[]
  ).map(toAttachment)
}

export function getAttachment(userId: number, id: string): Attachment {
  const row = getDb().prepare('SELECT * FROM attachments WHERE id = ? AND user_id = ?').get(id, userId) as
    | AttachmentRow
    | undefined
  if (!row) throw notFound('Datei nicht gefunden.')
  return toAttachment(row)
}

/** Sucht einen Anhang über den Dateinamen (wie Obsidian: ![[foto.jpg]]). Pfadangaben werden ignoriert. */
export function getAttachmentByName(userId: number, name: string): Attachment {
  const base = name.split('/').pop()!.trim()
  const row = getDb()
    .prepare('SELECT * FROM attachments WHERE user_id = ? AND filename = ? COLLATE NOCASE')
    .get(userId, base) as AttachmentRow | undefined
  if (!row) throw notFound('Datei nicht gefunden.')
  return toAttachment(row)
}

export function saveAttachment(userId: number, input: { name: string; type?: string | null; data: Uint8Array }): Attachment {
  const { maxUploadBytes } = getConfig()
  if (input.data.byteLength > maxUploadBytes) {
    throw new ApiError(
      413,
      'too_large',
      `Die Datei ist zu groß (max. ${Math.round(maxUploadBytes / 1024 / 1024)} MB).`,
    )
  }
  if (input.data.byteLength === 0) throw badRequest('Die Datei ist leer.')

  let filename = sanitizeFilename(input.name || 'Datei')
  if (!splitExtension(filename).ext && input.type && EXT_BY_MIME[input.type]) filename += EXT_BY_MIME[input.type]
  const mime = guessMime(filename)

  const db = getDb()
  const taken = (db.prepare('SELECT filename FROM attachments WHERE user_id = ?').all(userId) as { filename: string }[]).map(
    (r) => r.filename,
  )
  const { base, ext } = splitExtension(filename)
  filename = uniqueName(base, taken, ext)

  const id = uuid()
  fs.mkdirSync(userDir(userId), { recursive: true })
  fs.writeFileSync(filePath(userId, id), input.data)
  try {
    db.prepare('INSERT INTO attachments (id, user_id, filename, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      userId,
      filename,
      mime,
      input.data.byteLength,
      Date.now(),
    )
  } catch (err) {
    fs.rmSync(filePath(userId, id), { force: true })
    throw err
  }
  return getAttachment(userId, id)
}

export function deleteAttachment(userId: number, id: string) {
  getAttachment(userId, id)
  getDb().prepare('DELETE FROM attachments WHERE id = ? AND user_id = ?').run(id, userId)
  fs.rmSync(filePath(userId, id), { force: true })
}

export function readAttachmentData(userId: number, id: string): Buffer {
  return fs.readFileSync(filePath(userId, id))
}

function contentDisposition(type: 'inline' | 'attachment', filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** Liefert eine Datei aus – mit Range-Unterstützung (für Audio/Video) und strikter CSP. */
export function attachmentResponse(userId: number, att: Attachment, rangeHeader: string | null, download = false): Response {
  const p = filePath(userId, att.id)
  if (!fs.existsSync(p)) throw notFound('Datei nicht gefunden.')
  const size = fs.statSync(p).size
  const inline = !download && INLINE_MIME.test(att.mime)
  const headers = new Headers({
    'Content-Type': inline ? att.mime : att.mime === 'text/html' ? 'application/octet-stream' : att.mime,
    'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', att.filename),
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    // Auch wenn jemand z. B. eine SVG-Datei direkt öffnet: keine Skripte
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Accept-Ranges': 'bytes',
  })

  const range = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    let end = range[1] && range[2] ? Number(range[2]) : size - 1
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    end = Math.min(end, size - 1)
    start = Math.max(0, start)
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    headers.set('Content-Length', String(end - start + 1))
    const stream = Readable.toWeb(fs.createReadStream(p, { start, end })) as ReadableStream
    return new Response(stream, { status: 206, headers })
  }
  headers.set('Content-Length', String(size))
  const stream = Readable.toWeb(fs.createReadStream(p)) as ReadableStream
  return new Response(stream, { status: 200, headers })
}
