import { describe, expect, it, vi } from 'vitest'
import { makePdf } from '@/tests/pdf'
import { extractText, isSearchable } from './server/extract'
import { INDEX_MAX_CHARS, INDEX_MAX_PAGES } from './limits'

const utf8 = (text: string) => new TextEncoder().encode(text)

describe('Text aus Textdateien', () => {
  it('liest UTF-8 und Windows-1252 als eine Seite', async () => {
    expect(await extractText('text/plain', utf8('Größe;Maß\r\nzweite Zeile'))).toEqual({
      pages: ['Größe;Maß \nzweite Zeile'],
      truncated: null,
    })
    expect(await extractText('text/csv', Buffer.from('Größe;Maß', 'latin1'))).toEqual({ pages: ['Größe;Maß'], truncated: null })
    expect(await extractText('text/markdown', utf8('# Titel\n\u0002Text\u0003'))).toEqual({
      pages: ['# Titel\n Text '],
      truncated: null,
    })
  })

  it('schneidet nach 2 MB Text ab und überspringt leere oder binäre Dateien', async () => {
    const long = await extractText('text/plain', utf8('ä'.repeat(INDEX_MAX_CHARS + 10)))
    expect(long).toMatchObject({ truncated: 'nur die ersten 2 MB Text' })
    expect('pages' in long && long.pages[0].length).toBe(INDEX_MAX_CHARS)
    expect(await extractText('text/plain', utf8('  \n '))).toEqual({ skipped: 'kein Text gefunden' })
    expect(await extractText('text/plain', new Uint8Array([0x50, 0x4b, 0, 1, 2]))).toEqual({ skipped: 'kein Text gefunden' })
    expect(await extractText('image/png', utf8('Text'))).toEqual({ skipped: 'Dateityp wird nicht durchsucht' })
    expect(['application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'image/png'].map(isSearchable)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ])
  })
})

describe('Text aus PDFs', () => {
  it('liefert den Text je Seite – auch mit Umlauten – und lässt die Daten des Aufrufers unverändert', async () => {
    const data = new Uint8Array(makePdf([['Einleitung', 'Erste Seite'], [], ['Prüfung: Übungsblatt']]))
    const result = await extractText('application/pdf', data)
    expect(result).toMatchObject({ truncated: null })
    const pages = 'pages' in result ? result.pages.map((p) => p.replace(/\s+/g, ' ').trim()) : []
    expect(pages).toEqual(['Einleitung Erste Seite', '', 'Prüfung: Übungsblatt'])
    expect(data.byteLength).toBeGreaterThan(0)
  })

  it('überspringt PDFs ohne Text (Scans) und kaputte Dateien', async () => {
    expect(await extractText('application/pdf', makePdf([[], []]))).toEqual({ skipped: 'kein Text gefunden' })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await extractText('application/pdf', utf8('%PDF-1.4 kaputt'))).toEqual({ skipped: 'nicht lesbar' })
      expect(log).toHaveBeenCalledWith('[noted] PDF konnte nicht gelesen werden:', expect.any(String))
    } finally {
      log.mockRestore()
    }
  })

  it(`liest höchstens ${INDEX_MAX_PAGES} Seiten und gibt nach der Zeitgrenze auf`, async () => {
    const pdf = makePdf(Array.from({ length: INDEX_MAX_PAGES + 5 }, (_, i) => [`Seite ${i + 1}`]))
    const result = await extractText('application/pdf', pdf)
    expect(result).toMatchObject({ truncated: `nur die ersten ${INDEX_MAX_PAGES} Seiten` })
    expect('pages' in result && result.pages.length).toBe(INDEX_MAX_PAGES)
    expect('pages' in result && result.pages.at(-1)?.trim()).toBe(`Seite ${INDEX_MAX_PAGES}`)
    expect(await extractText('application/pdf', pdf, { timeoutMs: 0 })).toEqual({ skipped: 'zu groß' })
  })
})
