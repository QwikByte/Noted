import { describe, expect, it } from 'vitest'
import type { Box } from '@/shared/lib/spatial'
import { describeNode, keyTargets, nextFocus, outsideView, viewCenter, type View } from './keyboard'

const dot = (id: string, x: number, y: number): Box => ({ id, x, y, width: 10, height: 10 })

// Raster:   a   b
//           c     d (etwas tiefer)
const a = dot('a', 0, 0)
const b = dot('b', 100, 0)
const c = dot('c', 0, 100)
const d = dot('d', 200, 110)
const all = [a, b, c, d]

/** 400 × 300 Pixel, Graph um 50/50 verschoben, Zoom 1 – sichtbar ist also -50 … 350 × -50 … 250 */
const view: View = { x: 50, y: 50, zoom: 1, width: 400, height: 300 }

describe('Tastatur im Graphen', () => {
  it('beginnt an der Mitte des Ausschnitts oder an der Notiz des lokalen Graphen', () => {
    expect(viewCenter(view)).toEqual({ x: 150, y: 100 })
    expect(viewCenter({ ...view, zoom: 2 })).toEqual({ x: 75, y: 50 })
    expect(nextFocus(all, null, 'right', { point: { x: 290, y: 100 } })?.id).toBe('d')
    expect(nextFocus(all, null, 'right', { id: 'c', point: { x: 290, y: 100 } })?.id).toBe('c')
  })

  it('wandert in der Richtung weiter und bleibt am Rand stehen', () => {
    const start = { point: { x: 0, y: 0 } }
    expect(nextFocus(all, 'a', 'right', start)?.id).toBe('b')
    expect(nextFocus(all, 'a', 'down', start)?.id).toBe('c')
    expect(nextFocus(all, 'c', 'right', start)?.id).toBe('d')
    expect(nextFocus(all, 'a', 'left', start)).toBeNull()
  })

  it('wechselt während einer Suche nur zwischen den Treffern', () => {
    const hits = keyTargets(all, new Set(['a', 'd']))
    expect(hits.map((h) => h.id)).toEqual(['a', 'd'])
    // b liegt näher, ist aber kein Treffer
    expect(nextFocus(hits, 'a', 'right', { point: { x: 0, y: 0 } })?.id).toBe('d')
    // Die bisherige Notiz ist kein Treffer mehr: neu beginnen, am Treffer nahe der Mitte
    expect(nextFocus(hits, 'b', 'left', { point: { x: 250, y: 100 } })?.id).toBe('d')
    // Ohne Treffer bleiben alle erreichbar
    expect(keyTargets(all, new Set())).toBe(all)
    expect(keyTargets(all, new Set(['x']))).toBe(all)
  })

  it('erkennt Notizen außerhalb des Ausschnitts', () => {
    expect(outsideView(b, view)).toBe(false)
    expect(outsideView(dot('rechts', 320, 0), view)).toBe(true)
    expect(outsideView(dot('oben', 0, -60), view)).toBe(true)
    // Beim Herauszoomen passt mehr hinein
    expect(outsideView(dot('rechts', 320, 0), { ...view, zoom: 0.5 })).toBe(false)
    expect(outsideView(a, view, 0)).toBe(false)
  })

  it('sagt Titel und Verbindungen an', () => {
    expect(describeNode({ title: 'Entropie', links: 3 }, false)).toBe('Entropie, 3 Verbindungen')
    expect(describeNode({ title: 'Wärme', links: 1 }, true)).toBe('Wärme (diese Notiz), 1 Verbindung')
    expect(describeNode({ title: 'Allein', links: 0 }, false)).toBe('Allein, keine Verbindungen')
    expect(describeNode({ title: 'Index', links: 1200 }, false)).toBe('Index, 1.200 Verbindungen')
  })
})
