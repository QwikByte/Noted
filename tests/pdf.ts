// Test-PDFs ohne zusätzliches Paket: von Hand zusammengesetzt

/** Lesezeichen (Inhaltsverzeichnis) – Ziel ist der Anfang einer Seite (ab 1); `open`: Unterpunkte aufgeklappt */
export type PdfOutlineItem = { title: string; page: number; open?: boolean; items?: PdfOutlineItem[] }

export type PdfOptions = {
  outline?: PdfOutlineItem[]
  /** Seitenlabels als Bereiche ab Seite `from` (ab 1): D = 1, 2, 3 · r = i, ii, iii · R = I, II · a = a, b · A = A, B */
  labels?: { from: number; style?: 'D' | 'r' | 'R' | 'a' | 'A'; prefix?: string; start?: number }[]
  /** Interne Links: Rechteck auf Seite `page` (PDF-Koordinaten, Ursprung unten links), Ziel ist der Anfang von `to` */
  links?: { page: number; rect: [number, number, number, number]; to: number }[]
}

/** Text als PDF-String in UTF-16 (für Lesezeichen und Labels mit Umlauten) */
const utf16 = (text: string) =>
  `<FEFF${[...text].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('')}>`

/**
 * Kleines PDF mit Text (Standardschrift Helvetica, Umlaute über WinAnsi) – eine Seite pro Eintrag, eine leere Liste
 * ergibt eine Seite ohne Text (wie ein Scan). Die erste Zeile steht groß oben links (ab x = 60, y = 760). Optional mit
 * Lesezeichen, Seitenlabels und internen Links. Für Unit- und Browser-Tests.
 */
export function makePdf(pages: string[][], options: PdfOptions = {}): Buffer {
  const objects = new Map<number, string>()
  let nextId = 1
  const reserve = () => nextId++
  const font = reserve()
  const pagesId = reserve()
  const catalogId = reserve()
  const pageIds = pages.map(() => reserve())
  const dest = (page: number) => `[${pageIds[page - 1]} 0 R /XYZ 0 842 null]`

  objects.set(font, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  pages.forEach((lines, i) => {
    const text = lines.map((l, k) => `/F1 ${k === 0 ? 24 : 16} Tf (${l.replace(/[()\\]/g, '\\$&')}) Tj T*`).join('\n')
    const stream = `BT 60 760 Td 26 TL\n${text}\nET`
    const contents = reserve()
    objects.set(contents, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    const annots = (options.links ?? [])
      .filter((l) => l.page === i + 1)
      .map((l) => {
        const id = reserve()
        objects.set(id, `<< /Type /Annot /Subtype /Link /Rect [${l.rect.join(' ')}] /Border [0 0 0] /Dest ${dest(l.to)} >>`)
        return `${id} 0 R`
      })
    objects.set(
      pageIds[i],
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${contents} 0 R ` +
        `/Resources << /Font << /F1 ${font} 0 R >> >>${annots.length ? ` /Annots [${annots.join(' ')}]` : ''} >>`,
    )
  })
  objects.set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)

  // Lesezeichen als verkettete Liste je Ebene; Count < 0 heißt zugeklappt
  const visible = (items: PdfOutlineItem[]): number =>
    items.reduce((n, item) => n + 1 + (item.open && item.items ? visible(item.items) : 0), 0)
  const outline = (items: PdfOutlineItem[], parent: number): number[] => {
    const ids = items.map(() => reserve())
    items.forEach((item, i) => {
      const children = item.items?.length ? outline(item.items, ids[i]) : []
      const count = children.length ? ` /Count ${item.open ? visible(item.items!) : -children.length}` : ''
      objects.set(
        ids[i],
        `<< /Title ${utf16(item.title)} /Parent ${parent} 0 R /Dest ${dest(item.page)}` +
          (i > 0 ? ` /Prev ${ids[i - 1]} 0 R` : '') +
          (i < ids.length - 1 ? ` /Next ${ids[i + 1]} 0 R` : '') +
          (children.length ? ` /First ${children[0]} 0 R /Last ${children[children.length - 1]} 0 R${count}` : '') +
          ' >>',
      )
    })
    return ids
  }
  let catalog = `/Type /Catalog /Pages ${pagesId} 0 R`
  if (options.outline?.length) {
    const root = reserve()
    const top = outline(options.outline, root)
    objects.set(root, `<< /Type /Outlines /First ${top[0]} 0 R /Last ${top[top.length - 1]} 0 R /Count ${visible(options.outline)} >>`)
    catalog += ` /Outlines ${root} 0 R`
  }
  if (options.labels?.length) {
    const nums = options.labels.map(
      (l) =>
        `${l.from - 1} << ${l.style ? `/S /${l.style}` : ''}${l.prefix ? ` /P ${utf16(l.prefix)}` : ''}` +
        `${l.start ? ` /St ${l.start}` : ''} >>`,
    )
    catalog += ` /PageLabels << /Nums [${nums.join(' ')}] >>`
  }
  objects.set(catalogId, `<< ${catalog} >>`)

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < nextId; id++) {
    offsets.push(out.length)
    out += `${id} 0 obj\n${objects.get(id)}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${nextId}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${nextId} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
