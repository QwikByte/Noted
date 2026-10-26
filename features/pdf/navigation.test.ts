import { describe, expect, it } from 'vitest'
import { makePdf } from '@/tests/pdf'
import {
  MAX_OUTLINE_ENTRIES,
  PositionHistory,
  currentOutlinePath,
  pageFromInput,
  pageLabel,
  prepareOutline,
  usefulLabels,
  type DestinationResolver,
  type OutlineEntry,
  type RawOutlineItem,
} from './navigation'

/** PDF mit pdf.js öffnen wie auf dem Server (Worker im selben Prozess) */
async function openPdf(data: Buffer) {
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  Object.assign(globalThis, { pdfjsWorker: worker })
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 })
}

const raw = (title: string, dest: RawOutlineItem['dest'], items: RawOutlineItem[] = [], count?: number): RawOutlineItem => ({
  title,
  dest,
  url: null,
  count,
  items,
})

const entry = (path: string, page: number | null, items: OutlineEntry[] = []): OutlineEntry => ({
  path,
  title: path,
  dest: null,
  url: null,
  page,
  open: false,
  items,
})

describe('Inhaltsverzeichnis', () => {
  it('liest Lesezeichen, Seitenlabels und interne Links eines PDFs', async () => {
    const pages = Array.from({ length: 12 }, (_, i) => [`Seite ${i + 1}`])
    const task = await openPdf(
      makePdf(pages, {
        outline: [
          { title: 'Vorwort', page: 1 },
          {
            title: 'Kapitel 1 – Grundlagen',
            page: 3,
            open: true,
            items: [
              { title: '1.1 Mengen', page: 4 },
              { title: 'Übungen', page: 6 },
            ],
          },
          { title: 'Anhang', page: 10, items: [{ title: 'A Tabellen', page: 11 }] },
        ],
        labels: [{ from: 1, style: 'r' }, { from: 3, style: 'D' }],
        links: [{ page: 3, rect: [60, 750, 300, 790], to: 10 }],
      }),
    )
    const doc = await task.promise
    try {
      const outline = await prepareOutline(await doc.getOutline(), doc)
      const flat = (items: OutlineEntry[]): [string, string, number | null, boolean][] =>
        items.flatMap((e) => [[e.path, e.title, e.page, e.open] as [string, string, number | null, boolean], ...flat(e.items)])
      expect(flat(outline)).toEqual([
        ['1', 'Vorwort', 1, false],
        ['2', 'Kapitel 1 – Grundlagen', 3, true],
        ['2.1', '1.1 Mengen', 4, false],
        ['2.2', 'Übungen', 6, false],
        ['3', 'Anhang', 10, false],
        ['3.1', 'A Tabellen', 11, false],
      ])
      const labels = usefulLabels(await doc.getPageLabels(), doc.numPages)
      expect(labels).toEqual(['i', 'ii', ...Array.from({ length: 10 }, (_, i) => String(i + 1))])
      const [link] = await (await doc.getPage(3)).getAnnotations()
      expect(link).toMatchObject({ subtype: 'Link' })
      expect(await prepareOutline([raw('Link', link.dest)], doc)).toMatchObject([{ page: 10 }])
    } finally {
      await task.destroy()
    }
  })

  it('löst benannte Ziele und Seitennummern auf – Unbekanntes bleibt ohne Seite', async () => {
    const doc: DestinationResolver = {
      numPages: 20,
      getDestination: async (id) => (id === 'kap2' ? [{ num: 7, gen: 0 }, { name: 'XYZ' }, 0, 800, null] : null),
      getPageIndex: async (ref) => {
        if (ref.num === 7) return 4
        throw new Error('Invalid pageIndex request.')
      },
    }
    const outline = await prepareOutline(
      [
        raw('  Kapitel\n 2 ', 'kap2'),
        raw('Seite 3', [2, { name: 'Fit' }]),
        raw('', 'fehlt'),
        raw('Kaputt', [{ num: 99, gen: 0 }, { name: 'Fit' }]),
        raw('Außerhalb', [40, { name: 'Fit' }]),
        { ...raw('Adresse', null), url: 'https://example.org' },
      ],
      doc,
    )
    expect(outline.map((e) => [e.title, e.page])).toEqual([
      ['Kapitel 2', 5],
      ['Seite 3', 3],
      ['Ohne Titel', null],
      ['Kaputt', null],
      ['Außerhalb', null],
      ['Adresse', null],
    ])
    expect(await prepareOutline(null, doc)).toEqual([])
  })

  it(`zeigt höchstens ${MAX_OUTLINE_ENTRIES} Einträge, in der Reihenfolge des Inhaltsverzeichnisses`, async () => {
    const doc: DestinationResolver = { numPages: 1, getDestination: async () => null, getPageIndex: async () => 0 }
    const deep = [raw('Teil', null, Array.from({ length: MAX_OUTLINE_ENTRIES }, (_, i) => raw(`Abschnitt ${i}`, null))), raw('Rest', null)]
    const outline = await prepareOutline(deep, doc)
    expect(outline).toHaveLength(1)
    expect(outline[0].items).toHaveLength(MAX_OUTLINE_ENTRIES - 1)
  })

  it('bestimmt das aktuelle Kapitel samt übergeordneten Einträgen', () => {
    const outline = [
      entry('1', 3),
      entry('2', 10, [entry('2.1', 10), entry('2.2', 14, [entry('2.2.1', 15)])]),
      entry('3', null, [entry('3.1', 30)]),
    ]
    expect(currentOutlinePath(outline, 1)).toEqual([])
    expect(currentOutlinePath(outline, 5)).toEqual(['1'])
    // Kapitel und erster Abschnitt auf derselben Seite: der Abschnitt
    expect(currentOutlinePath(outline, 10)).toEqual(['2', '2.1'])
    expect(currentOutlinePath(outline, 16)).toEqual(['2', '2.2', '2.2.1'])
    expect(currentOutlinePath(outline, 40)).toEqual(['3', '3.1'])
  })
})

describe('Seitenzahlen wie im Skript', () => {
  const labels = ['i', 'ii', 'iii', 'iv', 'v', '1', '2', '3', 'A-1']

  it('nimmt Labels nur, wenn sie etwas anderes sagen als die Position', () => {
    expect(usefulLabels(null, 3)).toBeNull()
    expect(usefulLabels(['1', '2', '3'], 3)).toBeNull()
    expect(usefulLabels(['i', 'ii'], 3)).toBeNull()
    expect(usefulLabels(labels, labels.length)).toBe(labels)
    expect(pageLabel(5, labels)).toBe('v')
    expect(pageLabel(5, null)).toBe('5')
  })

  it('springt über das Label oder die Seitenzahl in der Datei', () => {
    expect(pageFromInput('v', labels, 9)).toBe(5)
    expect(pageFromInput(' V ', labels, 9)).toBe(5)
    expect(pageFromInput('a-1', labels, 9)).toBe(9)
    // Eine Zahl, die es als Label gibt, meint die Seite wie im Skript
    expect(pageFromInput('2', labels, 9)).toBe(7)
    expect(pageFromInput('9', labels, 9)).toBe(9)
    expect(pageFromInput('4', null, 9)).toBe(4)
    expect(pageFromInput('10', labels, 9)).toBe(9)
    expect(pageFromInput('0', null, 9)).toBe(1)
    expect(pageFromInput('xyz', labels, 9)).toBeNull()
    expect(pageFromInput('', labels, 9)).toBeNull()
  })
})

describe('Zurück nach internen Links', () => {
  const at = (page: number, top: number | null = 800) => ({ page, left: 0, top, scale: 'page-width' })

  it('springt zur jüngsten Stelle zurück, dieselbe Stelle nur einmal', () => {
    const history = new PositionHistory()
    expect(history.peek()).toBeNull()
    history.push(at(3, 500))
    history.push(at(3, 500.4))
    history.push(at(7))
    expect(history.peek()).toEqual(at(7))
    expect(history.pop()).toEqual(at(7))
    expect(history.pop()).toEqual(at(3, 500))
    expect(history.pop()).toBeNull()
  })

  it('behält höchstens 50 Stellen', () => {
    const history = new PositionHistory()
    for (let page = 1; page <= 60; page++) history.push(at(page))
    let count = 0
    let oldest = 0
    for (let pos = history.pop(); pos; pos = history.pop()) {
      count++
      oldest = pos.page
    }
    expect([count, oldest]).toEqual([50, 11])
  })
})
