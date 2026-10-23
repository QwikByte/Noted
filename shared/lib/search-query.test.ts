import { describe, expect, it } from 'vitest'
import { parseSearch } from './search-query'

describe('Suchanfrage zerlegen', () => {
  it('trennt Wörter und #tags', () => {
    expect(parseSearch('  Licht  wellen #Physik/Optik ')).toEqual({ terms: ['Licht', 'wellen'], tags: ['physik/optik'] })
    expect(parseSearch('#')).toEqual({ terms: [], tags: [] })
  })

  it('entfernt Steuerzeichen und nimmt höchstens 12 Teile', () => {
    expect(parseSearch('a\u0001b \u0002').terms).toEqual(['ab'])
    expect(parseSearch(Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ')).terms).toHaveLength(12)
  })
})
