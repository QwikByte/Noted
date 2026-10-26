import 'server-only'
import { z } from 'zod'
import { getDb } from '@/shared/server/db'
import { badRequest, notFound } from '@/shared/server/http'
import { isValidId, sha256 } from '@/shared/server/crypto'
import { getAttachment } from '@/features/attachments/server/attachments'
import {
  MAX_ANNOTATIONS_FILE_BYTES,
  MAX_ANNOTATIONS_PER_REQUEST,
  MAX_COMMENT,
  MAX_IMPORTED_ANNOTATIONS,
  MAX_QUOTE,
  MAX_RECTS,
} from '../limits'
import type { AnnotationColor, PdfAnnotation, PdfRect } from '../types'

type AnnotationRow = {
  id: string
  attachment_id: string
  page: number
  rects: string
  quote: string
  comment: string
  color: number
  created_at: number
  updated_at: number
}

const toAnnotation = (r: AnnotationRow): PdfAnnotation => ({
  id: r.id,
  attachmentId: r.attachment_id,
  page: r.page,
  rects: JSON.parse(r.rects) as PdfRect[],
  quote: r.quote,
  comment: r.comment,
  color: r.color as AnnotationColor,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const BAD_RECT = 'Ungültige Position einer Markierung.'
const coordinate = z.number(BAD_RECT).min(-100_000, BAD_RECT).max(100_000, BAD_RECT)
// Zeiten vergibt der Browser – nur plausible zulassen (der ZIP-Export kann nur 1980–2099 darstellen)
const time = z.number().int().min(Date.UTC(2000, 0, 1), 'Ungültiger Zeitpunkt.').max(Date.UTC(2099, 0, 1), 'Ungültiger Zeitpunkt.')

const annotationSchema = z.object({
  id: z.string().refine(isValidId, 'Ungültige ID einer Anmerkung.'),
  page: z.number().int().min(1, 'Ungültige Seite.').max(100_000, 'Ungültige Seite.'),
  rects: z
    .array(z.tuple([coordinate, coordinate, coordinate, coordinate], BAD_RECT), BAD_RECT)
    .min(1, 'Eine Markierung braucht mindestens eine Textzeile.')
    .max(MAX_RECTS, `Eine Markierung darf höchstens ${MAX_RECTS} Zeilen umfassen.`),
  quote: z.string().max(MAX_QUOTE, `Der markierte Text ist zu lang (höchstens ${MAX_QUOTE.toLocaleString('de-DE')} Zeichen).`),
  comment: z
    .string()
    .max(MAX_COMMENT, `Der Kommentar ist zu lang (höchstens ${MAX_COMMENT.toLocaleString('de-DE')} Zeichen).`),
  color: z.number().int().min(1, 'Unbekannte Farbe.').max(6, 'Unbekannte Farbe.'),
  createdAt: time,
  updatedAt: time,
})

export const annotationsInputSchema = z.object({
  annotations: z
    .array(annotationSchema)
    .max(
      MAX_ANNOTATIONS_PER_REQUEST,
      `Höchstens ${MAX_ANNOTATIONS_PER_REQUEST} Anmerkungen auf einmal – bitte in kleineren Teilen senden.`,
    ),
})

type AnnotationInput = z.infer<typeof annotationSchema>

/** Anhang des Nutzers, der Anmerkungen haben darf – fremde oder unbekannte IDs ergeben 404 */
function pdfAttachment(userId: number, attachmentId: string) {
  const att = getAttachment(userId, attachmentId)
  if (att.mime !== 'application/pdf') throw badRequest('Anmerkungen gibt es nur in PDF-Dateien.')
  return att
}

/** Alle Anmerkungen eines PDFs, nach Seite */
export function listAnnotations(userId: number, attachmentId: string): PdfAnnotation[] {
  pdfAttachment(userId, attachmentId)
  return (
    getDb()
      .prepare('SELECT * FROM pdf_annotations WHERE user_id = ? AND attachment_id = ? ORDER BY page, created_at')
      .all(userId, attachmentId) as AnnotationRow[]
  ).map(toAnnotation)
}

/** Anlegen oder ändern: Bei bekannter ID gewinnt der neuere Stand (updatedAt); IDs anderer Nutzer oder PDFs bleiben unberührt */
const UPSERT = `INSERT INTO pdf_annotations (id, user_id, attachment_id, page, rects, quote, comment, color, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    page = excluded.page, rects = excluded.rects, quote = excluded.quote, comment = excluded.comment,
    color = excluded.color, updated_at = excluded.updated_at
  WHERE pdf_annotations.user_id = excluded.user_id AND pdf_annotations.attachment_id = excluded.attachment_id
    AND excluded.updated_at >= pdf_annotations.updated_at`

const upsertValues = (id: string, userId: number, attachmentId: string, a: AnnotationInput) =>
  [id, userId, attachmentId, a.page, JSON.stringify(a.rects), a.quote.trim(), a.comment.trim(), a.color, a.createdAt, a.updatedAt]

/**
 * Anmerkungen anlegen oder ändern – idempotent per ID, damit offline gesammelte gefahrlos erneut gesendet werden
 * können. Bei bekannter ID gewinnt der neuere Stand (updatedAt); IDs anderer Nutzer oder PDFs bleiben unberührt.
 */
export function saveAnnotations(userId: number, attachmentId: string, list: AnnotationInput[]): { saved: number } {
  pdfAttachment(userId, attachmentId)
  const db = getDb()
  const upsert = db.prepare(UPSERT)
  let saved = 0
  db.transaction(() => {
    for (const a of list) saved += upsert.run(...upsertValues(a.id, userId, attachmentId, a)).changes
  })()
  return { saved }
}

/** Kennung und Version der Anmerkungen-Datei im Export („Skript.pdf.anmerkungen.json“) */
const FILE_FORMAT = 'noted-pdf-annotations'
const FILE_VERSION = 1

const annotationsFileSchema = z.object({
  format: z.literal(FILE_FORMAT),
  version: z.literal(FILE_VERSION, 'Diese Fassung der Anmerkungen kennt Noted nicht.'),
  file: z
    .string()
    .min(1, 'Zu welchem PDF die Anmerkungen gehören, fehlt.')
    .max(255, 'Ungültiger Dateiname.')
    .refine((name) => !name.includes('/'), 'Ungültiger Dateiname.'),
  annotations: z
    .array(annotationSchema)
    .max(MAX_IMPORTED_ANNOTATIONS, `Höchstens ${MAX_IMPORTED_ANNOTATIONS.toLocaleString('de-DE')} Anmerkungen je PDF.`),
})

type AnnotationsFile = z.infer<typeof annotationsFileSchema>

/** Anmerkungen eines PDFs als Datei für den Export – anders als die .md mit Positionen und Farben, zum Wiederherstellen */
export function annotationsFile(filename: string, list: PdfAnnotation[]): string {
  const file: AnnotationsFile = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    file: filename,
    annotations: list.map(({ id, page, rects, quote, comment, color, createdAt, updatedAt }) => ({
      id,
      page,
      rects,
      quote,
      comment,
      color,
      createdAt,
      updatedAt,
    })),
  }
  return JSON.stringify(file)
}

/**
 * Anmerkungen-Datei aus einem Export lesen – null, wenn es eine andere JSON-Datei ist (die bleibt ein gewöhnlicher
 * Anhang). Eine beschädigte oder zu große Datei ergibt einen verständlichen Fehler.
 */
export function readAnnotationsFile(data: Uint8Array): AnnotationsFile | null {
  if (data.byteLength > MAX_ANNOTATIONS_FILE_BYTES) throw badRequest('Die Anmerkungen-Datei ist zu groß.')
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(data))
  } catch {
    throw badRequest('Die Anmerkungen-Datei ist beschädigt.')
  }
  if (typeof json !== 'object' || json === null || (json as { format?: unknown }).format !== FILE_FORMAT) return null
  const parsed = annotationsFileSchema.safeParse(json)
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Die Anmerkungen-Datei ist beschädigt.')
  return parsed.data
}

/** Feste ID aus Konto, PDF und ursprünglicher ID – im Format von uuid() (Version 5) */
function derivedId(userId: number, attachmentId: string, id: string): string {
  const h = sha256(`${userId}:${attachmentId}:${id}`)
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/**
 * Anmerkungen aus einem Export übernehmen. Gehört eine ID schon einem anderen Konto oder PDF, bekommt die Anmerkung
 * eine aus Konto, PDF und alter ID abgeleitete – so ergibt auch ein erneuter Import keine Dubletten. Sonst gewinnt wie
 * beim Speichern der neuere Stand. Liefert die Zahl der übernommenen Anmerkungen.
 */
export function importAnnotations(userId: number, attachmentId: string, list: AnnotationInput[]): number {
  pdfAttachment(userId, attachmentId)
  const db = getDb()
  const upsert = db.prepare(UPSERT)
  const own = db.prepare('SELECT 1 FROM pdf_annotations WHERE id = ? AND user_id = ? AND attachment_id = ?')
  let saved = 0
  db.transaction(() => {
    for (const a of list) {
      let changes = upsert.run(...upsertValues(a.id, userId, attachmentId, a)).changes
      // Nichts geschrieben und auch keine eigene neuere Fassung: Die ID gehört einem anderen Konto oder PDF
      if (changes === 0 && !own.get(a.id, userId, attachmentId)) {
        changes = upsert.run(...upsertValues(derivedId(userId, attachmentId, a.id), userId, attachmentId, a)).changes
      }
      saved += changes
    }
  })()
  return saved
}

export function deleteAnnotation(userId: number, attachmentId: string, id: string) {
  pdfAttachment(userId, attachmentId)
  const result = getDb()
    .prepare('DELETE FROM pdf_annotations WHERE id = ? AND user_id = ? AND attachment_id = ?')
    .run(id, userId, attachmentId)
  if (result.changes === 0) throw notFound('Anmerkung nicht gefunden.')
}

/** Anmerkungen aller PDFs eines Nutzers, nach Anhang gruppiert (für den Export) */
export function annotationsByAttachment(userId: number): Map<string, PdfAnnotation[]> {
  const rows = getDb()
    .prepare('SELECT * FROM pdf_annotations WHERE user_id = ? ORDER BY attachment_id, page, created_at')
    .all(userId) as AnnotationRow[]
  const out = new Map<string, PdfAnnotation[]>()
  for (const r of rows) {
    const list = out.get(r.attachment_id)
    if (list) list.push(toAnnotation(r))
    else out.set(r.attachment_id, [toAnnotation(r)])
  }
  return out
}
