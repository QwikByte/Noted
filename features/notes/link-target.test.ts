import { describe, expect, it } from 'vitest'
import { validateName } from '@/shared/lib/names'
import { linkKey } from '@/shared/markdown/meta'
import { noteFromLinkTarget } from './link-target'

describe('Neue Notiz aus einem Link', () => {
  it('nimmt den letzten Teil als Titel und den Rest als Ordnerpfad', () => {
    expect(noteFromLinkTarget('Wellen')).toEqual({ title: 'Wellen', folderPath: [] })
    expect(noteFromLinkTarget('Physik/Wellen')).toEqual({ title: 'Wellen', folderPath: ['Physik'] })
    expect(noteFromLinkTarget(' Semester 1 / Analysis /Skript.md ')).toEqual({ title: 'Skript', folderPath: ['Semester 1', 'Analysis'] })
  })

  it('findet die neue Notiz danach über denselben Link', () => {
    for (const target of ['Physik/Wellen', 'Skript.md', 'Übung 1']) {
      const next = noteFromLinkTarget(target)
      expect('title' in next && linkKey(next.title)).toBe(linkKey(target))
    }
  })

  it('schlägt für ungültige Titel einen bereinigten vor', () => {
    for (const target of ['Was ist Entropie?', 'Zeit: 10 Uhr', 'Formel ^2', 'con', 'Ende.', 'Ordner/']) {
      const next = noteFromLinkTarget(target)
      expect(next, target).toHaveProperty('error')
      if ('error' in next) expect(validateName(next.suggestion), next.suggestion).toBeNull()
    }
    expect(noteFromLinkTarget('Was ist Entropie?')).toMatchObject({ suggestion: 'Was ist Entropie-' })
  })
})
