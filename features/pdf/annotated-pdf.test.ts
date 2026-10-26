import { beforeAll, describe, expect, it } from 'vitest'
import { makePdf } from '@/tests/pdf'
import { addAnnotationsToPdf, annotatedFileName } from './annotated-pdf'
import type { PdfAnnotation } from './types'

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjs: Pdfjs

// pdf.js unter Node: Der Worker läuft im selben Prozess (wie features/attachments/server/extract.ts)
beforeAll(async () => {
  Object.assign(globalThis, { pdfjsWorker: await import('pdfjs-dist/legacy/build/pdf.worker.mjs') })
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
})

const annotation = (patch: Partial<PdfAnnotation>): PdfAnnotation => ({
  id: 'a1',
  attachmentId: 'f1',
  page: 1,
  rects: [[60, 755, 200, 785]],
  quote: 'Entropie',
  comment: '',
  color: 3,
  createdAt: 1,
  updatedAt: 2,
  ...patch,
})

async function readAnnotations(data: Uint8Array) {
  const task = pdfjs.getDocument({ data, verbosity: 0 })
  try {
    const doc = await task.promise
    const out = []
    for (let i = 1; i <= doc.numPages; i++) out.push(await (await doc.getPage(i)).getAnnotations())
    return out
  } finally {
    await task.destroy()
  }
}

describe('PDF mit Markierungen', () => {
  it('schreibt Markierungen als /Highlight an dieselbe Stelle, mit Farbe und Kommentar', async () => {
    const original = new Uint8Array(makePdf([['Entropie'], ['Zweite Seite', 'mehr Text']]))
    const before = original.slice()
    const out = await addAnnotationsToPdf(pdfjs, original, [
      annotation({}),
      annotation({ id: 'a2', page: 2, rects: [[60, 755, 150, 785], [60, 725, 180, 745]], comment: 'Wichtig für die Klausur', color: 1 }),
      // Seiten, die es nicht gibt, fallen weg
      annotation({ id: 'a3', page: 9 }),
    ])
    expect(new TextDecoder('latin1').decode(out.slice(0, 5))).toBe('%PDF-')
    expect(new TextDecoder('latin1').decode(out)).toContain('/Highlight')
    // Das Original bleibt unverändert
    expect(original).toEqual(before)

    const [page1, page2] = await readAnnotations(out)
    const hl1 = page1.filter((a) => a.subtype === 'Highlight')
    expect(hl1).toHaveLength(1)
    expect(Array.from(hl1[0].rect as number[]).map(Math.round)).toEqual([60, 755, 200, 785])
    expect(Array.from(hl1[0].color as Uint8ClampedArray)).toEqual([255, 214, 0])
    // Mit eigenem Aussehen – auch Reader, die keins erzeugen, zeigen die Markierung
    expect(hl1[0].hasAppearance).toBe(true)

    const hl2 = page2.find((a) => a.subtype === 'Highlight')!
    expect(hl2.contentsObj.str).toBe('Wichtig für die Klausur')
    expect(Array.from(hl2.rect as number[]).map(Math.round)).toEqual([60, 725, 180, 785])
    expect(hl2.quadPoints).toHaveLength(16)
    expect(page2.some((a) => a.subtype === 'Popup')).toBe(true)
  })

  it('meldet beschädigte Dateien verständlich', async () => {
    await expect(addAnnotationsToPdf(pdfjs, new TextEncoder().encode('kein PDF'), [annotation({})])).rejects.toThrow(
      'beschädigt',
    )
  })

  it('benennt die Datei nach dem Original', () => {
    expect(annotatedFileName('Skripte/Thermo 1.pdf')).toBe('Thermo 1 (mit Markierungen).pdf')
    expect(annotatedFileName('Folien.PDF')).toBe('Folien (mit Markierungen).pdf')
  })
})
