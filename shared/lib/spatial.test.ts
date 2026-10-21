import { describe, expect, it } from 'vitest'
import { directionOf, nearestInDirection, nearestTo, type Box } from './spatial'

const box = (id: string, x: number, y: number): Box => ({ id, x, y, width: 100, height: 50 })

// Raster:   a  b
//           c   d (rechts, etwas tiefer)
const a = box('a', 0, 0)
const b = box('b', 200, 0)
const c = box('c', 0, 200)
const d = box('d', 400, 260)
const all = [a, b, c, d]

describe('Pfeiltasten auf freien Flächen', () => {
  it('findet das nächste Element in der Richtung', () => {
    expect(nearestInDirection(a, all, 'right')?.id).toBe('b')
    expect(nearestInDirection(a, all, 'down')?.id).toBe('c')
    expect(nearestInDirection(b, all, 'left')?.id).toBe('a')
    expect(nearestInDirection(c, all, 'up')?.id).toBe('a')
  })

  it('bevorzugt die gleiche Höhe vor einem schrägen, näheren Element', () => {
    // Von c nach rechts: d liegt fast auf gleicher Höhe, b ist näher, aber schräg darüber
    expect(nearestInDirection(c, all, 'right')?.id).toBe('d')
  })

  it('liefert nichts, wenn in der Richtung nichts liegt', () => {
    expect(nearestInDirection(a, all, 'left')).toBeNull()
    expect(nearestInDirection(a, all, 'up')).toBeNull()
    expect(nearestInDirection(a, [a], 'right')).toBeNull()
  })

  it('wählt das Element an einem Punkt und übersetzt Pfeiltasten', () => {
    expect(nearestTo({ x: 440, y: 280 }, all)?.id).toBe('d')
    expect(nearestTo({ x: 0, y: 0 }, [])).toBeNull()
    expect(directionOf('ArrowUp')).toBe('up')
    expect(directionOf('Enter')).toBeNull()
  })
})
