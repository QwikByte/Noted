// Gemeinsame Helfer für die Browser-Tests
import { expect, type Page, type Request } from '@playwright/test'

/** Schreibende API-Anfragen wie die App (CSRF-Header) */
export async function apiHeaders(page: Page) {
  const me = await page.evaluate(() => fetch('/api/auth/me').then((r) => r.json()))
  return { 'x-noted-request': '1', 'x-noted-user': String(me.user.id) }
}

export { makePdf } from '../tests/pdf'

/**
 * Anfragen der Seite mitzählen – vor dem ersten Seitenaufruf anlegen. `idle()` vor dem Offline-Schalten: 5 s nach dem
 * Start lädt die App Editoren und den PDF-Viewer für den Offline-Betrieb nach. Schaltet ein Test mittendrin ab, bricht
 * der Browser diese Ladevorgänge ab und meldet sie als Fehler in der Konsole.
 */
export function trackRequests(page: Page) {
  const open = new Set<Request>()
  let changed = Date.now()
  page.on('request', (r) => {
    open.add(r)
    changed = Date.now()
  })
  const done = (r: Request) => {
    open.delete(r)
    changed = Date.now()
  }
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  return {
    /** Wartet, bis das Nachladen gelaufen ist und eine halbe Sekunde lang keine Anfrage lief */
    async idle() {
      await page.waitForFunction(() => performance.now() > 7_000, null, { timeout: 15_000 })
      await expect.poll(() => open.size === 0 && Date.now() - changed > 500, { timeout: 15_000 }).toBe(true)
    },
  }
}

/** Text eines PDFs (z. B. aus page.pdf()), ein Eintrag je Seite */
export async function pdfPages(data: Buffer): Promise<string[]> {
  // Den Worker vorab laden wie auf dem Server (features/attachments/server/extract.ts) – sonst sucht pdf.js eine Datei
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  Object.assign(globalThis, { pdfjsWorker: worker })
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 })
  const doc = await task.promise
  try {
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent()
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
    }
    return pages
  } finally {
    await task.destroy()
  }
}
