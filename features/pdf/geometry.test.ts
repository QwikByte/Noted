import { describe, expect, it } from 'vitest'
import {
  annotationAt,
  annotationsMarkdown,
  cleanQuote,
  highlightGeometry,
  joinSelection,
  mergeLineRects,
  sortAnnotations,
  toPdfRect,
  toViewRect,
} from './geometry'
import { MAX_QUOTE, MAX_RECTS } from './limits'
import type { PdfAnnotation } from './types'

// Seite 595 × 842 pt wie pdf.js sie für eine Ansicht berechnet: ohne Drehung …
const transform = (scale: number) => [scale, 0, 0, -scale, 0, 842 * scale]
// … und um 90° gedreht
const rotated = (scale: number) => [0, scale, scale, 0, 0, 0]

const annotation = (id: string, page: number, rects: PdfAnnotation['rects'], extra: Partial<PdfAnnotation> = {}): PdfAnnotation => ({
  id,
  attachmentId: 'a',
  page,
  rects,
  quote: id,
  comment: '',
  color: 3,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
})

describe('Koordinaten', () => {
  it('rechnet eine Markierung bei jedem Zoom auf dieselbe Stelle im PDF um', () => {
    // Zeile 100 pt vom oberen Rand, 200 pt breit – bei 100 % und bei 250 %
    expect(toPdfRect(transform(1), { left: 60, top: 100, width: 200, height: 20 })).toEqual([60, 722, 260, 742])
    expect(toPdfRect(transform(2.5), { left: 150, top: 250, width: 500, height: 50 })).toEqual([60, 722, 260, 742])
    expect(toViewRect(transform(2), [60, 722, 260, 742])).toEqual({ left: 120, top: 200, width: 400, height: 40 })
  })

  it('hin und zurück ergibt dasselbe Rechteck – auch bei gedrehter Seite', () => {
    const r = { left: 33.5, top: 71.25, width: 120, height: 14 }
    for (const t of [transform(1.37), rotated(0.8)]) {
      const back = toViewRect(t, toPdfRect(t, r))
      expect(back.left).toBeCloseTo(r.left, 1)
      expect(back.top).toBeCloseTo(r.top, 1)
      expect(back.width).toBeCloseTo(r.width, 1)
      expect(back.height).toBeCloseTo(r.height, 1)
    }
  })
})

describe('Textauswahl', () => {
  it('fasst die Stücke einer Zeile zusammen und lässt Zeilen getrennt', () => {
    const merged = mergeLineRects([
      { left: 10, top: 100, width: 40, height: 12 },
      { left: 52, top: 101, width: 30, height: 11 },
      { left: 84, top: 100, width: 0, height: 12 },
      { left: 10, top: 120, width: 60, height: 12 },
      { left: 300, top: 100, width: 20, height: 12 },
    ])
    expect(merged).toEqual([
      { left: 10, top: 100, width: 72, height: 12 },
      { left: 300, top: 100, width: 20, height: 12 },
      { left: 10, top: 120, width: 60, height: 12 },
    ])
    const many = Array.from({ length: MAX_RECTS + 10 }, (_, i) => ({ left: 0, top: i * 20, width: 10, height: 10 }))
    expect(mergeLineRects(many)).toHaveLength(MAX_RECTS)
  })

  it('bereinigt und kürzt das Zitat', () => {
    expect(cleanQuote('  Erster   Hauptsatz  \n der  Thermodynamik ')).toBe('Erster Hauptsatz\n der Thermodynamik')
    const long = cleanQuote('x'.repeat(MAX_QUOTE + 5))
    expect(long).toHaveLength(MAX_QUOTE)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('Auswahl über Seitengrenzen', () => {
  const rect: PdfAnnotation['rects'][number] = [60, 700, 300, 720]

  it('setzt die Seiten in ihrer Reihenfolge zusammen – auch rückwärts ausgewählt', () => {
    const joined = joinSelection(
      [
        { page: 5, text: 'Anfang auf Seite fünf', rects: [rect] },
        { page: 4, text: 'Ende des Satzes  auf vier', rects: [rect] },
      ],
      'egal',
    )
    expect(joined.text).toBe('Ende des Satzes auf vier\nAnfang auf Seite fünf')
    expect(joined.parts.map((p) => p.page)).toEqual([4, 5])
  })

  it('lässt Seiten ohne Auswahl weg und nimmt den ganzen Text, wenn eine Seite dazwischen fehlt', () => {
    const empty = { page: 2, text: '', rects: [] }
    expect(joinSelection([{ page: 1, text: 'Eins', rects: [rect] }, empty], 'x').parts.map((p) => p.page)).toEqual([1])
    const gap = joinSelection(
      [
        { page: 1, text: 'Eins', rects: [rect] },
        { page: 3, text: 'Drei', rects: [rect] },
      ],
      'Eins \nZwei\nDrei',
    )
    expect(gap.text).toBe('Eins\nZwei\nDrei')
    expect(gap.parts.map((p) => p.page)).toEqual([1, 3])
  })

  it('nimmt ohne Text-Layer den Text des Browsers', () => {
    expect(joinSelection([], '  Text  ohne   Ebene ')).toEqual({ text: 'Text ohne Ebene', parts: [] })
  })
})

describe('Markierungen', () => {
  const list = [
    annotation('unten', 2, [[50, 100, 300, 120]]),
    annotation('oben', 2, [[50, 700, 300, 720]], { comment: 'Wichtig!' }),
    annotation('vorne', 1, [[50, 400, 300, 420]], { quote: 'Zeile eins\nZeile zwei' }),
    annotation('darüber', 2, [[100, 690, 200, 730]], { createdAt: 5 }),
  ]

  it('sortiert wie im Dokument und findet die Markierung unter dem Finger', () => {
    expect(sortAnnotations(list).map((a) => a.id)).toEqual(['vorne', 'darüber', 'oben', 'unten'])
    expect(annotationAt(list, 60, 710)?.id).toBe('oben')
    expect(annotationAt(list, 150, 710)?.id).toBe('darüber')
    expect(annotationAt(list, 10, 10)).toBeNull()
  })

  it('exportiert als lesbares Markdown', () => {
    expect(annotationsMarkdown('Skript.pdf', list)).toBe(
      [
        '# Anmerkungen zu Skript.pdf',
        '',
        '## Seite 1',
        '',
        '> Zeile eins',
        '> Zeile zwei',
        '',
        '## Seite 2',
        '',
        '> darüber',
        '',
        '> oben',
        '',
        'Wichtig!',
        '',
        '> unten',
        '',
      ].join('\n'),
    )
  })
})

describe('Markierungen als PDF-Anmerkung', () => {
  it('liefert Hülle, QuadPoints und Umrisse je Rechteck', () => {
    const g = highlightGeometry([
      [60, 755, 150, 785],
      [60, 725, 180, 745],
    ])
    expect(g.rect).toEqual([60, 725, 180, 785])
    // links oben, rechts oben, links unten, rechts unten
    expect(g.quadPoints).toEqual([60, 785, 150, 785, 60, 755, 150, 755, 60, 745, 180, 745, 60, 725, 180, 725])
    expect(g.outlines).toEqual([
      [60, 755, 150, 755, 150, 785, 60, 785],
      [60, 725, 180, 725, 180, 745, 60, 745],
    ])
  })
})
