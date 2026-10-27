import { describe, expect, it } from 'vitest'
import { formatPageList, parsePageList } from './pages'

describe('Seitenauswahl', () => {
  it('liest einzelne Seiten und Bereiche in jeder Schreibweise', () => {
    expect(parsePageList('3', 10)).toEqual([3])
    expect(parsePageList(' 8, 3-5;4 ', 10)).toEqual([3, 4, 5, 8])
    expect(parsePageList('1–2 9—10', 10)).toEqual([1, 2, 9, 10])
  })

  it('meldet, was nicht geht', () => {
    expect(parsePageList('', 10)).toContain('Gib an')
    expect(parsePageList('drei', 10)).toBe('„drei“ ist keine Seite. Schreib z. B. „3–5, 8“.')
    expect(parsePageList('0', 10)).toBe('Das PDF hat die Seiten 1 bis 10.')
    expect(parsePageList('9-11', 10)).toBe('Das PDF hat die Seiten 1 bis 10.')
    expect(parsePageList('5-3', 10)).toBe('Das PDF hat die Seiten 1 bis 10.')
    expect(parsePageList('1-21', 100)).toBe('Höchstens 20 Seiten auf einmal.')
    expect(parsePageList('1-15, 20-30', 100)).toBe('Höchstens 20 Seiten auf einmal.')
  })

  it('schreibt Seiten kurz zusammen', () => {
    expect(formatPageList([8, 3, 4, 5, 4])).toBe('3–5, 8')
    expect(formatPageList([7])).toBe('7')
  })
})
