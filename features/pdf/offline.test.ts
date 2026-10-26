import { describe, expect, it } from 'vitest'
import { entriesToDelete, type CacheEntry } from './offline'

const MB = 1024 * 1024
const pdf = (key: string, name: string, size: number, opened: number): CacheEntry => ({ key, file: { name, size: size * MB, pdf: true }, opened })

describe('Offline-Speicher aufräumen', () => {
  it('entfernt Einträge zu Dateien, die es nicht mehr gibt – auch markierte', () => {
    const entries = [pdf('/api/files/A.pdf', 'A.pdf', 1, 5), { key: '/api/files/Weg.pdf', file: null, opened: 9 }]
    expect(entriesToDelete(entries, new Set(['weg.pdf']))).toEqual(['/api/files/Weg.pdf'])
  })

  it('hält das Budget ein: die am längsten nicht geöffneten zuerst, markierte bleiben', () => {
    const entries = [
      pdf('/api/files/Neu.pdf', 'Neu.pdf', 120, 300),
      pdf('/api/files/Mittel.pdf', 'Mittel.pdf', 120, 200),
      pdf('/api/files/Alt.pdf', 'Alt.pdf', 120, 100),
      pdf('/api/files/Nie.pdf', 'Nie.pdf', 10, 0),
      pdf('/api/files/Klausur.pdf', 'Klausur.pdf', 500, 1),
    ]
    expect(entriesToDelete(entries, new Set(['klausur.pdf']), 300 * MB)).toEqual(['/api/files/Alt.pdf', '/api/files/Nie.pdf'])
    expect(entriesToDelete(entries, new Set(['klausur.pdf']), 1000 * MB)).toEqual([])
  })

  it('zählt eine Datei unter Name und ID einmal und entfernt beide Einträge gemeinsam', () => {
    const entries = [
      pdf('/api/files/Skript.pdf', 'Skript.pdf', 200, 50),
      pdf('/api/attachments/1234', 'Skript.pdf', 200, 0),
      pdf('/api/files/Folien.pdf', 'Folien.pdf', 200, 80),
    ]
    expect(entriesToDelete(entries, new Set(), 300 * MB)).toEqual(['/api/files/Skript.pdf', '/api/attachments/1234'])
  })

  it('Bilder und andere Dateien zählen nicht zum Budget', () => {
    const image: CacheEntry = { key: '/api/attachments/9', file: { name: 'Foto.jpg', size: 900 * MB, pdf: false }, opened: 0 }
    expect(entriesToDelete([image], new Set(), 300 * MB)).toEqual([])
  })
})
