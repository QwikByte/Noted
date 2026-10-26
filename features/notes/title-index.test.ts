import { describe, expect, it } from 'vitest'
import { createTitleIndexer, newestFirst, titleSignature } from './title-index'

type N = { id: string; title: string; folderId: string | null; vault: boolean; updatedAt: number; excerpt: string }
const n = (id: string, title: string, extra: Partial<N> = {}): N => ({
  id,
  title,
  folderId: null,
  vault: false,
  updatedAt: 1,
  excerpt: '',
  ...extra,
})

describe('Titelindex', () => {
  it('gruppiert nach Linkschlüssel, Tresor-Notizen getrennt', () => {
    const index = createTitleIndexer<N>()([n('a', 'Analysis'), n('b', 'analysis', { folderId: 'f' }), n('c', 'Analysis', { vault: true })])
    expect(index.plain.get('analysis')?.map((x) => x.id)).toEqual(['a', 'b'])
    expect(index.inVault.get('analysis')?.map((x) => x.id)).toEqual(['c'])
  })

  it('gleiche Signatur, gleicher Index – beim Tippen ändern sich nur Auszug und Bearbeitungszeit', () => {
    const indexOf = createTitleIndexer<N>()
    const notes = [n('a', 'Analysis'), n('b', 'Lineare Algebra')]
    const first = indexOf(notes)
    const typed = [{ ...notes[0], updatedAt: 99, excerpt: 'Folgen und Reihen' }, notes[1]]
    expect(titleSignature(typed)).toBe(titleSignature(notes))
    expect(indexOf(typed)).toBe(first)
    // Neuer Titel, verschoben, in den Tresor oder eine Notiz mehr: neuer Index
    for (const changed of [
      [{ ...notes[0], title: 'Analysis I' }, notes[1]],
      [{ ...notes[0], folderId: 'f' }, notes[1]],
      [{ ...notes[0], vault: true }, notes[1]],
      [...notes, n('c', 'Stochastik')],
    ]) {
      expect(titleSignature(changed)).not.toBe(titleSignature(notes))
      expect(indexOf(changed)).not.toBe(first)
      indexOf(notes)
    }
  })

  it('löst Gleichstände erst beim Auflösen nach der aktuellen Bearbeitungszeit', () => {
    const list = [n('alt', 'Skript'), n('neu', 'Skript')]
    const times: Record<string, number> = { alt: 5, neu: 10 }
    expect(newestFirst(list, (id) => times[id]).map((x) => x.id)).toEqual(['neu', 'alt'])
    times.alt = 20
    expect(newestFirst(list, (id) => times[id]).map((x) => x.id)).toEqual(['alt', 'neu'])
    expect(newestFirst([list[0]], () => 0)).toEqual([list[0]])
  })
})
