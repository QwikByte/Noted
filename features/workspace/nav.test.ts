import { describe, expect, it } from 'vitest'
import { viewFromParams, viewToUrl, type View } from './client/nav'

const roundTrip = (view: View) => viewFromParams(new URLSearchParams(viewToUrl(view).slice(2)))

describe('Adressen der Ansichten', () => {
  it('nimmt Suchwörter für die Fundstelle in der Notiz mit', () => {
    expect(viewToUrl({ kind: 'note', id: 'n1', find: 'taylor reihe' })).toBe('/?n=n1&find=taylor%20reihe')
    expect(roundTrip({ kind: 'note', id: 'n1', find: 'Übung & Satz' })).toEqual({
      kind: 'note',
      id: 'n1',
      heading: undefined,
      find: 'Übung & Satz',
    })
    expect(roundTrip({ kind: 'note', id: 'n1', heading: 'Kapitel 2' })).toEqual({
      kind: 'note',
      id: 'n1',
      heading: 'Kapitel 2',
      find: undefined,
    })
  })

  it('nimmt die eigene Übung mit – nur im Übungsmodus und nur bekannte Filter', () => {
    expect(viewToUrl({ kind: 'study', scope: 'deck:d1', mode: 'practice', filter: 'problem' })).toBe('/?s=deck%3Ad1&m=practice&filter=problem')
    expect(roundTrip({ kind: 'study', scope: 'all', mode: 'practice', filter: 'again-today' })).toEqual({
      kind: 'study',
      scope: 'all',
      mode: 'practice',
      filter: 'again-today',
    })
    expect(viewFromParams(new URLSearchParams('s=all&filter=problem'))).toMatchObject({ mode: 'learn', filter: undefined })
    expect(viewFromParams(new URLSearchParams('s=all&m=practice&filter=unbekannt'))).toMatchObject({ filter: undefined })
  })

  it('nimmt den Suchbegriff des Kartenbrowsers mit – nicht als Notizsuche', () => {
    expect(viewToUrl({ kind: 'browse' })).toBe('/?v=browse')
    expect(viewToUrl({ kind: 'browse', q: 'Taylor & Reihe' })).toBe('/?v=browse&cq=Taylor%20%26%20Reihe')
    expect(roundTrip({ kind: 'browse', q: 'Taylor & Reihe' })).toEqual({ kind: 'browse', q: 'Taylor & Reihe' })
    expect(roundTrip({ kind: 'browse' })).toEqual({ kind: 'browse', q: undefined })
  })
})
