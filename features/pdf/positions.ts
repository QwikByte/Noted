// Zuletzt benutzte Ansicht je PDF (auf diesem Gerät): Seite, Zoom, Drehung, Folienmodus. Reine Logik – PdfPanel liest
// und schreibt den lokalen Speicher. Ältere Einträge enthalten nur die Seite als Zahl.

export type PdfMode = 'scroll' | 'slides'
export type Rotation = 0 | 90 | 180 | 270

/** `scale`: currentScaleValue von pdf.js – 'page-width', 'page-fit', 'auto' oder ein Faktor wie '1.5' */
export type PdfView = { page: number; scale?: string; rotation?: Rotation; mode?: PdfMode }

/** Höchstens so viele PDFs merken – die zuletzt geöffneten */
export const MAX_VIEWS = 50

const AUTO_SCALES = ['page-width', 'page-fit', 'auto']

const validScale = (s: unknown): s is string =>
  typeof s === 'string' && (AUTO_SCALES.includes(s) || (/^\d+(\.\d+)?$/.test(s) && Number(s) >= 0.1 && Number(s) <= 10))

const validPage = (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 100_000

function parseView(value: unknown): PdfView | null {
  if (validPage(value)) return { page: value }
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const view: PdfView = { page: validPage(v.page) ? v.page : 1 }
  if (validScale(v.scale)) view.scale = v.scale
  if (v.rotation === 0 || v.rotation === 90 || v.rotation === 180 || v.rotation === 270) view.rotation = v.rotation
  if (v.mode === 'scroll' || v.mode === 'slides') view.mode = v.mode
  return view
}

/** Gespeicherte Ansichten (JSON aus dem lokalen Speicher) – ungültige Einträge fallen weg */
export function parseViews(raw: string | null): Record<string, PdfView> {
  let data: unknown
  try {
    data = raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const views: Record<string, PdfView> = {}
  for (const [file, value] of Object.entries(data)) {
    const view = parseView(value)
    if (view) views[file] = view
  }
  return views
}

/** Ansicht eines PDFs ändern – es rückt ans Ende (zuletzt benutzt), ältere über MAX_VIEWS fallen weg */
export function withView(views: Record<string, PdfView>, file: string, patch: Partial<PdfView>): Record<string, PdfView> {
  const { [file]: current, ...rest } = views
  const entries = Object.entries({ ...rest, [file]: { ...(current ?? { page: 1 }), ...patch } })
  return Object.fromEntries(entries.slice(-MAX_VIEWS))
}

/** Nächste Drehung im Uhrzeigersinn */
export const rotateRight = (rotation: Rotation): Rotation => ((rotation + 90) % 360) as Rotation
