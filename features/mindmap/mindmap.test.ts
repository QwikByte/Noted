import { describe, expect, it } from 'vitest'
import {
  addChild,
  addSibling,
  findNode,
  isMindmapMarkdown,
  layoutMindmap,
  mindmapPropertiesOf,
  mindmapToMarkdown,
  moveNode,
  newMindmap,
  parseMindmap,
  removeNode,
  serializeMindmap,
  setNodeText,
  shiftNode,
  type MindNode,
} from './mindmap'

/** Baum ohne IDs – zum Vergleichen */
const shape = (n: MindNode): unknown => (n.children.length ? { [n.text]: n.children.map(shape) } : n.text)

const SAMPLE = `---
mindmap-plugin: basic
tags: [uni]
---

# Thermodynamik

## Hauptsätze
- Erster Hauptsatz
\t- Energieerhaltung
- Zweiter Hauptsatz

## Begriffe
- [[Entropie]]
- Enthalpie
`

describe('Mindmap als Markdown-Gliederung', () => {
  it('liest Überschriften und verschachtelte Listen als Baum', () => {
    const root = parseMindmap(SAMPLE, 'Titel')
    expect(shape(root)).toEqual({
      Thermodynamik: [
        { Hauptsätze: [{ 'Erster Hauptsatz': ['Energieerhaltung'] }, 'Zweiter Hauptsatz'] },
        { Begriffe: ['[[Entropie]]', 'Enthalpie'] },
      ],
    })
  })

  it('schreibt die Gliederung mit „mindmap-plugin: basic“ und behält die Properties', () => {
    const root = parseMindmap(SAMPLE, 'Titel')
    expect(serializeMindmap(root, mindmapPropertiesOf(SAMPLE))).toBe(SAMPLE)
  })

  it('übersteht Lesen und Schreiben verlustfrei, auch tief verschachtelt', () => {
    let root = parseMindmap(newMindmap('Projekt'), 'x')
    root = addChild(root, root.id, { id: 'a', text: 'A', children: [] })
    root = addChild(root, 'a', { id: 'b', text: 'B', children: [] })
    root = addChild(root, 'b', { id: 'c', text: 'C #tag', children: [] })
    root = addChild(root, 'c', { id: 'd', text: '1. kein Listenpunkt', children: [] })
    const md = serializeMindmap(root, null)
    expect(md).toBe('---\nmindmap-plugin: basic\n---\n\n# Projekt\n\n## A\n- B\n\t- C #tag\n\t\t- 1. kein Listenpunkt\n')
    expect(serializeMindmap(parseMindmap(md, 'x'), mindmapPropertiesOf(md))).toBe(md)
  })

  it('macht aus beliebigem Markdown eine Mindmap (Absätze werden Knoten, Code entfällt)', () => {
    const md = '## Teil 1\nEin Absatz,\nder weitergeht.\n\n```js\nconst x = 1\n```\n\n* Punkt\n  mit Folgezeile\n1. Nummer\n\n## Teil 2'
    expect(shape(parseMindmap(md, 'Vorlesung'))).toEqual({
      Vorlesung: [{ 'Teil 1': ['Ein Absatz, der weitergeht.', 'Punkt mit Folgezeile', 'Nummer'] }, 'Teil 2'],
    })
  })

  it('nimmt den Titel als Wurzel, wenn es keine oberste Überschrift gibt', () => {
    expect(shape(parseMindmap('', 'Neu'))).toBe('Neu')
    expect(shape(parseMindmap('- a\n- b', 'Liste'))).toEqual({ Liste: ['a', 'b'] })
  })

  it('erkennt Mindmaps beim Import und wandelt sie zurück in Markdown', () => {
    expect(isMindmapMarkdown(SAMPLE)).toBe(true)
    expect(isMindmapMarkdown('# Nur Markdown')).toBe(false)
    expect(isMindmapMarkdown('---\nmindmap-plugin: rich\n---\n')).toBe(false)
    const plain = mindmapToMarkdown(SAMPLE)
    expect(plain.startsWith('---\ntags: [uni]\n---\n\n# Thermodynamik')).toBe(true)
    expect(mindmapToMarkdown(newMindmap('X'))).toBe('# X\n')
  })
})

describe('Mindmap bearbeiten', () => {
  const base = (): MindNode => ({
    id: 'r',
    text: 'R',
    children: [
      { id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] },
      { id: 'b', text: 'B', children: [] },
    ],
  })

  it('fügt Unterpunkte und Nachbarn ein, ändert Text und löscht', () => {
    let root = addSibling(base(), 'a', { id: 'n', text: 'N', children: [] })
    expect(root.children.map((c) => c.text)).toEqual(['A', 'N', 'B'])
    root = setNodeText(root, 'n', ' Neu\nzeilig ')
    expect(findNode(root, 'n')?.text).toBe('Neu zeilig')
    root = removeNode(root, 'a')
    expect(shape(root)).toEqual({ R: ['Neu zeilig', 'B'] })
  })

  it('verschiebt Knoten, aber nie in den eigenen Ast', () => {
    const root = base()
    expect(shape(moveNode(root, 'b', 'a1'))).toEqual({ R: [{ A: [{ A1: ['B'] }] }] })
    expect(moveNode(root, 'a', 'a1')).toBe(root)
    expect(moveNode(root, 'r', 'b')).toBe(root)
    expect(shiftNode(root, 'b', -1).children.map((c) => c.id)).toEqual(['b', 'a'])
    expect(shiftNode(root, 'a', -1)).toBe(root)
  })

  it('ordnet die Hauptäste rechts und links an, ohne dass sich Knoten überlappen', () => {
    let root: MindNode = { id: 'r', text: 'R', children: [] }
    for (let i = 0; i < 5; i++) {
      root = addChild(root, 'r', { id: `c${i}`, text: `C${i}`, children: [] })
      for (let j = 0; j < 3; j++) root = addChild(root, `c${i}`, { id: `c${i}-${j}`, text: `K${j}`, children: [] })
    }
    const placed = layoutMindmap(root, () => ({ width: 100, height: 30 }), new Set())
    expect(placed).toHaveLength(21)
    const rootBox = placed[0]
    expect(rootBox.x + rootBox.width / 2).toBe(0)
    expect(placed.filter((p) => p.depth === 1 && p.side === 'right').map((p) => p.node.id)).toEqual(['c0', 'c2', 'c4'])
    expect(placed.filter((p) => p.depth === 1 && p.side === 'left').map((p) => p.node.id)).toEqual(['c1', 'c3'])
    for (const p of placed.filter((n) => n.side === 'left')) expect(p.x + p.width).toBeLessThan(rootBox.x)
    for (const a of placed) {
      for (const b of placed) {
        if (a === b) continue
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
        expect(overlap, `${a.node.id} überlappt ${b.node.id}`).toBe(false)
      }
    }
    expect(placed.find((p) => p.node.id === 'c3-2')?.branch).toBe(3)
    // Ein weiterer Ast verschiebt die bisherigen nicht auf die andere Seite
    const more = layoutMindmap(addChild(root, 'r', { id: 'c5', text: 'C5', children: [] }), () => ({ width: 100, height: 30 }), new Set())
    expect(more.filter((p) => p.depth === 1).map((p) => `${p.node.id}:${p.side}`).sort()).toEqual(
      ['c0:right', 'c1:left', 'c2:right', 'c3:left', 'c4:right', 'c5:left'],
    )
    // Eingeklappte Äste zeigen ihre Unterpunkte nicht
    expect(layoutMindmap(root, () => ({ width: 100, height: 30 }), new Set(['c0', 'c1']))).toHaveLength(15)
  })
})
