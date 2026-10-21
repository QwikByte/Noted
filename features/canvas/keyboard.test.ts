import { describe, expect, it } from 'vitest'
import {
  arrowCommand,
  cardLabel,
  moveNodes,
  nextCard,
  nextTarget,
  readingIndex,
  resizeNode,
  toBoxes,
} from './keyboard'
import { MIN_NODE_SIZE, type CanvasNode } from './canvas'

const keys = (key: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
})

// Raster:  a   b
//          c
const NODES: CanvasNode[] = [
  { id: 'g', type: 'group', label: 'Kapitel', x: -20, y: -20, width: 640, height: 200 },
  { id: 'a', type: 'text', text: '## Wärme\nEnergie, die übertragen wird', x: 0, y: 0, width: 200, height: 100 },
  { id: 'b', type: 'text', text: 'Temperatur', x: 400, y: 0, width: 200, height: 100 },
  { id: 'c', type: 'file', file: 'Skript.pdf', x: 0, y: 300, width: 200, height: 100 },
]
const boxes = toBoxes(
  NODES.filter((n) => n.type !== 'group').map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    measured: { width: n.width, height: n.height },
  })),
)

describe('Canvas mit der Tastatur', () => {
  it('ordnet Pfeiltasten Wählen, Verschieben und Größe zu', () => {
    const cmd = (key: string, mods?: Parameters<typeof keys>[1]) => arrowCommand(keys(key, mods))
    expect(cmd('ArrowRight')).toEqual({ action: 'select', dir: 'right', step: 0 })
    expect(cmd('ArrowLeft', { altKey: true })).toEqual({ action: 'move', dir: 'left', step: 20 })
    expect(cmd('ArrowUp', { altKey: true, shiftKey: true })).toEqual({ action: 'move', dir: 'up', step: 100 })
    expect(cmd('ArrowDown', { ctrlKey: true })).toEqual({ action: 'resize', dir: 'down', step: 20 })
    expect(cmd('ArrowRight', { metaKey: true, shiftKey: true })).toEqual({ action: 'resize', dir: 'right', step: 100 })
    // Strg+Alt+Pfeil gehört dem Betriebssystem, Umschalt+Pfeil allein ist nicht belegt
    expect(cmd('ArrowRight', { ctrlKey: true, altKey: true })).toBeNull()
    expect(cmd('ArrowRight', { shiftKey: true })).toBeNull()
    expect(cmd('Enter')).toBeNull()
  })

  it('liest die Lage aus den Knoten von React Flow', () => {
    expect(boxes[0]).toEqual({ id: 'a', x: 0, y: 0, width: 200, height: 100 })
    expect(toBoxes([{ id: 'x', position: { x: 5, y: 6 } }])).toEqual([{ id: 'x', x: 5, y: 6, width: 0, height: 0 }])
  })

  it('wählt die nächste Karte in der Richtung – ohne Auswahl die nächste zur Bildmitte', () => {
    expect(nextCard(boxes, 'a', 'right', { x: 0, y: 0 })?.id).toBe('b')
    expect(nextCard(boxes, 'b', 'left', { x: 0, y: 0 })?.id).toBe('a')
    expect(nextCard(boxes, 'a', 'down', { x: 0, y: 0 })?.id).toBe('c')
    expect(nextCard(boxes, 'b', 'right', { x: 0, y: 0 })).toBeNull()
    expect(nextCard(boxes, null, 'right', { x: 480, y: 40 })?.id).toBe('b')
    // Eine Auswahl, die es nicht mehr gibt (z. B. nach Rückgängig), zählt wie keine
    expect(nextCard(boxes, 'weg', 'up', { x: 90, y: 340 })?.id).toBe('c')
  })

  it('wählt beim Verbinden ein Ziel, aber nie die Quelle', () => {
    expect(nextTarget(boxes, 'a', null, 'right')?.id).toBe('b')
    // Von b nach links bzw. von c nach oben läge die Quelle a am nächsten – sie wird übersprungen
    expect(nextTarget(boxes, 'a', 'b', 'left')?.id).toBe('c')
    expect(nextTarget(boxes, 'a', 'c', 'up')?.id).toBe('b')
    expect(nextTarget(boxes, 'a', 'b', 'right')).toBeNull()
    expect(nextTarget(boxes, 'weg', null, 'right')).toBeNull()
  })

  it('zählt Karten in Lesereihenfolge', () => {
    expect(readingIndex(boxes, 'a')).toBe(1)
    expect(readingIndex(boxes, 'b')).toBe(2)
    expect(readingIndex(boxes, 'c')).toBe(3)
  })

  it('verschiebt die Auswahl – eine Gruppe mit ihren Karten', () => {
    const moved = moveNodes(NODES, new Set(['c']), 'right', 20)
    expect(moved.find((n) => n.id === 'c')).toMatchObject({ x: 20, y: 300 })
    expect(moved.filter((n) => n.id !== 'c')).toEqual(NODES.filter((n) => n.id !== 'c'))

    // Karte a liegt in der Gruppe und ist zusätzlich ausgewählt: Sie bewegt sich trotzdem nur einmal
    const group = moveNodes(NODES, new Set(['g', 'a']), 'up', 100)
    expect(group.map((n) => [n.id, n.x, n.y])).toEqual([
      ['g', -20, -120],
      ['a', 0, -100],
      ['b', 400, -100],
      ['c', 0, 300],
    ])
  })

  it('ändert die Größe, aber nicht unter die Mindestgröße', () => {
    const a = NODES[1]
    expect(resizeNode(a, 'right', 20)).toMatchObject({ x: 0, y: 0, width: 220, height: 100 })
    expect(resizeNode(a, 'up', 20)).toMatchObject({ width: 200, height: 80 })
    expect(resizeNode(a, 'left', 1000)).toMatchObject({ width: MIN_NODE_SIZE, height: 100 })
    const small = { ...a, width: MIN_NODE_SIZE }
    expect(resizeNode(small, 'left', 20)).toBe(small)
  })

  it('benennt Karten für Bildschirmleser', () => {
    const rect = { id: 'n', x: 0, y: 0, width: 200, height: 100 }
    expect(cardLabel(NODES[1])).toBe('Textkarte „Wärme Energie, die übertragen wird“')
    expect(cardLabel({ ...rect, type: 'text', text: '  ' })).toBe('Leere Textkarte')
    expect(cardLabel({ ...rect, type: 'text', text: 'x'.repeat(100) })).toBe(`Textkarte „${'x'.repeat(59)}…“`)
    expect(cardLabel(NODES[3])).toBe('Datei „Skript.pdf“')
    expect(cardLabel({ ...rect, type: 'file', file: 'Entropie' })).toBe('Notiz „Entropie“')
    expect(cardLabel({ ...rect, type: 'link', url: 'https://example.org' })).toBe('Link „https://example.org“')
    expect(cardLabel(NODES[0])).toBe('Gruppe „Kapitel“')
    expect(cardLabel({ ...rect, type: 'group' })).toBe('Gruppe ohne Namen')
  })
})
