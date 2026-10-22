// Gemeinsame Helfer für die Browser-Tests
import type { Page } from '@playwright/test'

/** Schreibende API-Anfragen wie die App (CSRF-Header) */
export async function apiHeaders(page: Page) {
  const me = await page.evaluate(() => fetch('/api/auth/me').then((r) => r.json()))
  return { 'x-noted-request': '1', 'x-noted-user': String(me.user.id) }
}

export { makePdf } from '../tests/pdf'

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
