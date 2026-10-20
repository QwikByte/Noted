import { describe, expect, it } from 'vitest'
import { rewriteFileUrls, shareFileUrl } from './links'

describe('Dateien in geteilten Notizen', () => {
  it('führt Dateien über den Link statt über /api/files', () => {
    expect(shareFileUrl('tok', 'Uni/Tafel bild.png')).toBe('/api/s/tok/files/Uni/Tafel%20bild.png')
    const html = '<p><img src="/api/files/Tafel%20bild.png"><a href=\'/api/files/Skript.pdf#page=2\'>S. 2</a> /api/files/frei</p>'
    expect(rewriteFileUrls(html, 'tok')).toBe(
      '<p><img src="/api/s/tok/files/Tafel%20bild.png"><a href=\'/api/s/tok/files/Skript.pdf#page=2\'>S. 2</a> /api/files/frei</p>',
    )
    expect(rewriteFileUrls('[S. 3](/api/files/Skript.pdf#page=3) ![[bild.png]]', 'tok')).toBe(
      '[S. 3](/api/s/tok/files/Skript.pdf#page=3) ![[bild.png]]',
    )
  })
})
