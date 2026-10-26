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
})
