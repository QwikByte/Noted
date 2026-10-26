import { describe, expect, it } from 'vitest'
import { MAX_VIEWS, parseViews, rotateRight, withView } from './positions'

describe('Ansicht je PDF', () => {
  it('liest alte Einträge (nur die Seite) und neue mit Zoom, Drehung und Modus', () => {
    const raw = JSON.stringify({
      'Alt.pdf': 12,
      'Neu.pdf': { page: 3, scale: '1.5', rotation: 90, mode: 'slides' },
      'Breite.pdf': { page: 2, scale: 'page-width' },
    })
    expect(parseViews(raw)).toEqual({
      'Alt.pdf': { page: 12 },
      'Neu.pdf': { page: 3, scale: '1.5', rotation: 90, mode: 'slides' },
      'Breite.pdf': { page: 2, scale: 'page-width' },
    })
  })

  it('verwirft ungültige Werte', () => {
    const raw = JSON.stringify({
      'a.pdf': { page: 0, scale: 'riesig', rotation: 45, mode: 'quer' },
      'b.pdf': 'drei',
      'c.pdf': -4,
      'd.pdf': { page: 2, scale: '99' },
      'e.pdf': null,
    })
    expect(parseViews(raw)).toEqual({ 'a.pdf': { page: 1 }, 'd.pdf': { page: 2 } })
    expect(parseViews('kein json')).toEqual({})
    expect(parseViews('[1,2]')).toEqual({})
    expect(parseViews(null)).toEqual({})
  })

  it('ändert nur, was sich ändert, und merkt höchstens 50 PDFs – das zuletzt benutzte zuletzt', () => {
    let views = parseViews(JSON.stringify({ 'Skript.pdf': 7, 'Anderes.pdf': 2 }))
    views = withView(views, 'Skript.pdf', { scale: '1.5' })
    expect(views).toEqual({ 'Anderes.pdf': { page: 2 }, 'Skript.pdf': { page: 7, scale: '1.5' } })
    views = withView(views, 'Neu.pdf', { rotation: 90 })
    expect(views['Neu.pdf']).toEqual({ page: 1, rotation: 90 })
    for (let i = 0; i < 60; i++) views = withView(views, `f${i}.pdf`, { page: i + 1 })
    expect(Object.keys(views)).toHaveLength(MAX_VIEWS)
    expect(views['Skript.pdf']).toBeUndefined()
    expect(Object.keys(views).at(-1)).toBe('f59.pdf')
  })

  it('dreht im Uhrzeigersinn', () => {
    expect([0, 90, 180, 270].map((r) => rotateRight(r as 0 | 90 | 180 | 270))).toEqual([90, 180, 270, 0])
  })
})
