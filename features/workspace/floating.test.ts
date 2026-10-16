import { describe, expect, it } from 'vitest'
import { dragPoint, formatPoint, nudgePoint, parsePoint, pointStyle, snapPoint } from './floating'

const FALLBACK = { x: 1, y: 0.5 }

describe('Position schwebender Elemente', () => {
  it('liest gespeicherte Positionen und begrenzt sie auf die Fläche', () => {
    expect(parsePoint('0.25,0.75', FALLBACK)).toEqual({ x: 0.25, y: 0.75 })
    expect(parsePoint('-3,7', FALLBACK)).toEqual({ x: 0, y: 1 })
    expect(parsePoint(formatPoint({ x: 1 / 3, y: 0 }), FALLBACK)).toEqual({ x: 0.3333, y: 0 })
  })

  it('fällt bei Unsinn auf die Standardposition zurück', () => {
    expect(parsePoint('', FALLBACK)).toBe(FALLBACK)
    expect(parsePoint('0.5', FALLBACK)).toBe(FALLBACK)
    expect(parsePoint('a,b', FALLBACK)).toBe(FALLBACK)
    expect(parsePoint(',0.5', FALLBACK)).toBe(FALLBACK)
  })

  it('setzt links/oben so, dass das Element am Rand bündig abschließt', () => {
    expect(pointStyle({ x: 0, y: 1 })).toEqual({ left: '0%', top: '100%', transform: 'translate(0%, -100%)' })
    expect(pointStyle({ x: 0.5, y: 0.5 })).toEqual({ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' })
  })

  it('rechnet gezogene Pixel in Anteile der freien Fläche um', () => {
    expect(dragPoint({ x: 0.5, y: 0.5 }, 100, -50, 400, 200)).toEqual({ x: 0.75, y: 0.25 })
    // Über den Rand hinaus bleibt es am Rand
    expect(dragPoint({ x: 0.9, y: 0.1 }, 1000, -1000, 400, 200)).toEqual({ x: 1, y: 0 })
    // Füllt das Element die Fläche ganz aus, bleibt es, wo es ist
    expect(dragPoint({ x: 0.3, y: 0.6 }, 50, 50, 0, -10)).toEqual({ x: 0.3, y: 0.6 })
  })

  it('verschiebt mit den Pfeiltasten', () => {
    expect(nudgePoint({ x: 0.5, y: 0.5 }, 'ArrowLeft')).toEqual({ x: 0.45, y: 0.5 })
    expect(nudgePoint({ x: 0.5, y: 0.9 }, 'ArrowDown', { big: true })).toEqual({ x: 0.5, y: 1 })
    expect(nudgePoint({ x: 0.5, y: 0.5 }, 'Enter')).toBeNull()
  })

  it('rastet oben oder unten ein – je nachdem, was näher liegt', () => {
    expect(snapPoint({ x: 0.3, y: 0.49 })).toEqual({ x: 0.3, y: 0 })
    expect(snapPoint({ x: 0.3, y: 0.5 })).toEqual({ x: 0.3, y: 1 })
    // ↑/↓ springen beim Einrasten direkt an den anderen Rand, ←/→ bleiben schrittweise
    expect(nudgePoint({ x: 0.5, y: 1 }, 'ArrowUp', { snap: true })).toEqual({ x: 0.5, y: 0 })
    expect(nudgePoint({ x: 0.5, y: 0 }, 'ArrowDown', { snap: true })).toEqual({ x: 0.5, y: 1 })
    expect(nudgePoint({ x: 0.5, y: 0 }, 'ArrowRight', { snap: true })).toEqual({ x: 0.55, y: 0 })
  })
})
