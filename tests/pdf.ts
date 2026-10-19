// Test-PDFs ohne zusätzliches Paket: von Hand zusammengesetzt

/**
 * Kleines PDF mit Text (Standardschrift Helvetica, Umlaute über WinAnsi) – eine Seite pro Eintrag, eine leere Liste
 * ergibt eine Seite ohne Text (wie ein Scan). Für Unit- und Browser-Tests.
 */
export function makePdf(pages: string[][]): Buffer {
  const objects: string[] = ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']
  const pagesId = 2 + pages.length * 2
  const pageIds: number[] = []
  for (const lines of pages) {
    const text = lines.map((l, i) => `/F1 ${i === 0 ? 24 : 16} Tf (${l.replace(/[()\\]/g, '\\$&')}) Tj T*`).join('\n')
    const stream = `BT 60 760 Td 26 TL\n${text}\nET`
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    objects.push(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${objects.length} 0 R /Resources << /Font << /F1 1 0 R >> >> >>`)
    pageIds.push(objects.length)
  }
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  objects.push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  let out = '%PDF-1.4\n'
  const offsets = objects.map((o, i) => {
    const offset = out.length
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
    return offset
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
