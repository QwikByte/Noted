import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPdf, pdfErrorMessage, VIEWER_OFFLINE } from './client/pdfjs'

const FILE_OFFLINE = 'Dieses PDF ist offline noch nicht verfügbar. Öffne es einmal mit Verbindung, danach geht es auch offline.'
const online = (onLine: boolean) => vi.stubGlobal('navigator', { onLine })

afterEach(() => vi.unstubAllGlobals())

describe('PDFs laden – verständliche Meldungen offline', () => {
  it('ein PDF, das offline nicht im Speicher liegt', async () => {
    online(false)
    // Antwort des Service Workers
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503, headers: { 'x-noted-offline': '1' } })))
    await expect(fetchPdf('Skript.pdf')).rejects.toThrow(FILE_OFFLINE)
    // Ohne Service Worker scheitert schon die Anfrage
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(fetchPdf('Skript.pdf')).rejects.toThrow(FILE_OFFLINE)
  })

  it('online bleibt es bei den bisherigen Meldungen', async () => {
    online(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
    await expect(fetchPdf('Skript.pdf')).rejects.toThrow('Die Datei wurde nicht gefunden.')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('%PDF', { status: 200 })))
    expect(new TextDecoder().decode(await fetchPdf('Skript.pdf'))).toBe('%PDF')
  })

  it('fehlende Dateien des Viewers offline: Hinweis statt technischer Meldung', () => {
    const worker = new Error('Setting up fake worker failed: "Failed to fetch dynamically imported module"')
    online(false)
    expect(pdfErrorMessage(worker)).toBe(VIEWER_OFFLINE)
    expect(pdfErrorMessage(new Error(FILE_OFFLINE))).toBe(FILE_OFFLINE)
    online(true)
    expect(pdfErrorMessage(new Error('Das PDF hat 3 Seiten.'))).toBe('Das PDF hat 3 Seiten.')
  })
})
