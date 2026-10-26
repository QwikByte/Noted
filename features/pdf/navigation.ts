// Navigation im PDF-Viewer ohne Bezug zu pdf.js oder dem Browser: Inhaltsverzeichnis aufbereiten, aktuelles Kapitel
// bestimmen, Seitenzahlen wie im Skript (Seitenlabels) und der Verlauf für „Zurück“ nach internen Links.

/** Lesezeichen, wie es pdf.js liefert (getOutline) – nur die Felder, die Noted braucht */
export type RawOutlineItem = {
  title: string
  dest: string | unknown[] | null
  url: string | null
  count?: number
  items: RawOutlineItem[]
}

type PageRef = { num: number; gen: number }

/** Was es braucht, um Ziele aufzulösen – erfüllt PDFDocumentProxy */
export type DestinationResolver = {
  getDestination(id: string): Promise<unknown[] | null>
  getPageIndex(ref: PageRef): Promise<number>
  numPages: number
}

/**
 * Eintrag im Inhaltsverzeichnis. `page`: physische Seite des Ziels (null bei Adressen und unauflösbaren Zielen),
 * `open`: Unterpunkte anfangs aufgeklappt, `path`: Kennung aus den Positionen (z. B. „2.1“).
 */
export type OutlineEntry = {
  path: string
  title: string
  dest: string | unknown[] | null
  url: string | null
  page: number | null
  open: boolean
  items: OutlineEntry[]
}

/** Mehr Einträge zeigt das Inhaltsverzeichnis nicht – sonst löste ein riesiges PDF tausende Ziele auf */
export const MAX_OUTLINE_ENTRIES = 2000

/** Physische Seite (ab 1) eines Ziels – über eine Seitenreferenz oder die Nummer im Ziel, sonst null */
async function destinationPage(doc: DestinationResolver, dest: RawOutlineItem['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    const ref = Array.isArray(explicit) ? explicit[0] : null
    const index = Number.isInteger(ref) ? (ref as number) : ref && typeof ref === 'object' ? await doc.getPageIndex(ref as PageRef) : null
    return index !== null && index >= 0 && index < doc.numPages ? index + 1 : null
  } catch {
    return null
  }
}

/** Lesezeichen mit der Seite ihres Ziels – leere Titel heißen „Ohne Titel“, mehr als MAX_OUTLINE_ENTRIES entfallen */
export async function prepareOutline(raw: RawOutlineItem[] | null, doc: DestinationResolver): Promise<OutlineEntry[]> {
  let budget = MAX_OUTLINE_ENTRIES
  // Der Reihe nach in die Tiefe – das Budget geht an die Einträge in der Reihenfolge des Inhaltsverzeichnisses
  const walk = (items: RawOutlineItem[], prefix: string): Promise<OutlineEntry[]> =>
    Promise.all(
      items.flatMap((item, i) => {
        if (budget <= 0) return []
        budget--
        const path = prefix ? `${prefix}.${i + 1}` : String(i + 1)
        const children = walk(item.items ?? [], path)
        const page = item.dest ? destinationPage(doc, item.dest) : null
        return [
          (async (): Promise<OutlineEntry> => ({
            path,
            title: item.title.replace(/\s+/g, ' ').trim() || 'Ohne Titel',
            dest: item.dest,
            url: item.url,
            page: await page,
            open: (item.count ?? 0) > 0,
            items: await children,
          }))(),
        ]
      }),
    )
  return raw?.length ? walk(raw, '') : []
}

/**
 * Aktuelles Kapitel: der Eintrag mit dem spätesten Ziel bis zur Seite `page` (bei gleicher Seite der letzte, also der
 * tiefste Unterabschnitt) – als Pfad von der obersten Ebene bis zu ihm, leer vor dem ersten Kapitel.
 */
export function currentOutlinePath(entries: OutlineEntry[], page: number): string[] {
  const best = { page: 0, trail: [] as string[] }
  const visit = (items: OutlineEntry[], trail: string[]) => {
    for (const item of items) {
      const here = [...trail, item.path]
      if (item.page !== null && item.page <= page && item.page >= best.page) {
        best.page = item.page
        best.trail = here
      }
      visit(item.items, here)
    }
  }
  visit(entries, [])
  return best.trail
}

/** Seitenlabels nur, wenn sie zum Dokument passen und etwas anderes sagen als die Position in der Datei */
export function usefulLabels(labels: string[] | null, numPages: number): string[] | null {
  if (!labels || labels.length !== numPages) return null
  return labels.every((label, i) => label === String(i + 1)) ? null : labels
}

/** Seite für die Anzeige: das Label wie im Skript, sonst die Position in der Datei */
export const pageLabel = (page: number, labels: string[] | null) => labels?.[page - 1] || String(page)

/**
 * Eingabe im Seitenfeld: zuerst ein Label wie im Skript („v“, „S. 10“, ohne Rücksicht auf Groß-/Kleinschreibung), sonst
 * eine Seitenzahl in der Datei – zu große bzw. kleine wie bisher die letzte bzw. erste Seite. null bei anderem Text.
 */
export function pageFromInput(input: string, labels: string[] | null, numPages: number): number | null {
  const value = input.trim()
  if (!value) return null
  if (labels) {
    const exact = labels.indexOf(value)
    if (exact >= 0) return exact + 1
    const lower = value.toLowerCase()
    const loose = labels.findIndex((label) => label.toLowerCase() === lower)
    if (loose >= 0) return loose + 1
  }
  if (!/^\d+$/.test(value) || numPages < 1) return null
  return Math.max(1, Math.min(numPages, Number(value)))
}

/** Stelle im Dokument: Seite, Ausschnitt in PDF-Koordinaten (wie pdf.js sie meldet) und Zoom (Prozent oder z. B. „page-width“) */
export type ViewPosition = { page: number; left: number | null; top: number | null; scale: number | string | null }

/** Die Methoden, die der PDFLinkService von pdf.js vor und nach dem Folgen eines Links aufruft */
export type LinkHistory = {
  pushCurrentPosition(): void
  push(params: { pageNumber: number }): void
  pushPage(pageNumber: number): void
  back(): void
  forward(): void
}

const HISTORY_LIMIT = 50

/** Stellen vor internen Links – „Zurück“ springt zur jüngsten. Je Dokument, ältere fallen ab 50 weg. */
export class PositionHistory {
  private stack: ViewPosition[] = []

  push(position: ViewPosition) {
    const last = this.peek()
    // Derselbe Link zweimal: nicht zweimal zurück an dieselbe Stelle
    if (last && last.page === position.page && Math.abs((last.top ?? 0) - (position.top ?? 0)) < 1) return
    this.stack.push(position)
    if (this.stack.length > HISTORY_LIMIT) this.stack.shift()
  }

  pop(): ViewPosition | null {
    return this.stack.pop() ?? null
  }

  peek(): ViewPosition | null {
    return this.stack[this.stack.length - 1] ?? null
  }
}
