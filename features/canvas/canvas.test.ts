import { describe, expect, it } from 'vitest'
import {
  canvasForExport,
  canvasText,
  canvasToMarkdown,
  canvasWithText,
  mapCanvasNodes,
  nearestSides,
  nodesInGroup,
  parseCanvas,
  serializeCanvas,
  type CanvasData,
} from './canvas'
import { extractLinks, extractTags } from '@/shared/markdown/meta'

const SAMPLE: CanvasData = {
  nodes: [
    { id: 'g', type: 'group', label: 'Grundlagen', x: 0, y: 0, width: 600, height: 400, color: '4' },
    { id: 't1', type: 'text', text: 'Definition #physik', x: 20, y: 40, width: 200, height: 80 },
    { id: 'f1', type: 'file', file: 'Skript.pdf', subpath: '#page=3', x: 300, y: 40, width: 200, height: 200 },
    { id: 'n1', type: 'file', file: 'Entropie', x: 20, y: 200, width: 200, height: 100 },
    { id: 'l1', type: 'link', url: 'https://example.org', x: 800, y: -100, width: 300, height: 80 },
  ],
  edges: [{ id: 'e1', fromNode: 't1', fromSide: 'right', toNode: 'f1', toSide: 'left', label: 'siehe' }],
}

describe('JSON Canvas', () => {
  it('liest und schreibt JSON Canvas (eine Karte pro Zeile)', () => {
    const json = serializeCanvas(SAMPLE)
    expect(json.split('\n')[2]).toBe('\t\t{"id":"g","type":"group","label":"Grundlagen","x":0,"y":0,"width":600,"height":400,"color":"4"},')
    expect(parseCanvas(json)).toEqual(SAMPLE)
    expect(serializeCanvas({ nodes: [], edges: [] })).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}\n')
  })

  it('behält unbekannte Felder und verwirft ungültige Karten und Pfeile', () => {
    const json = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', text: 'A', x: 1, y: 2, width: 100, height: 50, styleAttributes: { shape: 'pill' } },
        { id: 'a', type: 'text', text: 'doppelt', x: 0, y: 0, width: 10, height: 10 },
        { id: 'b', type: 'file', x: 0, y: 0, width: 10, height: 10 },
        { id: 'c', type: 'unbekannt', x: 0, y: 0, width: 10, height: 10 },
        { type: 'text', text: 'ohne ID' },
      ],
      edges: [
        { id: 'e', fromNode: 'a', toNode: 'a', fromSide: 'oben' },
        { id: 'f', fromNode: 'a', toNode: 'b' },
      ],
    })
    const data = parseCanvas(json)!
    expect(data.nodes).toHaveLength(1)
    expect(data.nodes[0]).toMatchObject({ id: 'a', styleAttributes: { shape: 'pill' } })
    expect(data.edges).toEqual([{ id: 'e', fromNode: 'a', toNode: 'a' }].map((e) => expect.objectContaining(e)))
    expect(data.edges[0].fromSide).toBeUndefined()
  })

  it('erkennt ungültige Inhalte; leer ist ein leeres Canvas', () => {
    expect(parseCanvas('')).toEqual({ nodes: [], edges: [] })
    expect(parseCanvas('{kaputt')).toBeNull()
    expect(parseCanvas('[]')).toBeNull()
    expect(parseCanvas('{"nodes":{}}')).toBeNull()
  })

  it('liefert Text für Suche, Tags und Rückverweise in Lesereihenfolge', () => {
    const json = serializeCanvas(SAMPLE)
    // Der Link liegt über der Gruppe, die Karten der Gruppe folgen ihrer Überschrift
    expect(canvasToMarkdown(SAMPLE)).toBe('https://example.org\n\n## Grundlagen\n\nDefinition #physik\n\n![[Skript.pdf#page=3]]\n\n[[Entropie]]')
    const text = canvasText(json)
    expect(text.endsWith('siehe')).toBe(true)
    expect(extractTags(text)).toEqual(['physik'])
    expect(extractLinks(text)).toEqual([{ key: 'entropie', path: '' }])
    expect(canvasText('{kaputt')).toBe('')
  })

  it('schreibt beim Export die Pfade im ZIP in die Dateikarten', () => {
    const json = serializeCanvas(SAMPLE)
    const exported = canvasForExport(json, {
      attachmentFolder: 'Anhänge',
      attachments: ['skript.pdf'],
      notePaths: new Map([['entropie', 'Physik/Entropie.md']]),
    })
    const files = parseCanvas(exported)!.nodes.flatMap((n) => (n.type === 'file' ? [n.file] : []))
    expect(files).toEqual(['Anhänge/skript.pdf', 'Physik/Entropie.md'])
    expect(canvasForExport('', { attachmentFolder: 'Anhänge', attachments: [], notePaths: new Map() })).toBe(
      serializeCanvas({ nodes: [], edges: [] }),
    )
  })

  it('ändert den Inhalt nur, wenn sich eine Karte ändert', () => {
    const json = JSON.stringify(SAMPLE)
    expect(mapCanvasNodes(json, (n) => n)).toBe(json)
    const renamed = mapCanvasNodes(json, (n) => (n.type === 'file' && n.file === 'Entropie' ? { ...n, file: 'Wärme' } : n))
    expect(renamed).toContain('"file":"Wärme"')
  })

  it('findet Karten in Gruppen und die passenden Seiten für Pfeile', () => {
    const [group] = SAMPLE.nodes
    expect(nodesInGroup(SAMPLE.nodes, group).map((n) => n.id)).toEqual(['t1', 'f1', 'n1'])
    const box = (x: number, y: number) => ({ id: '', x, y, width: 10, height: 10 })
    expect(nearestSides(box(0, 0), box(100, 10))).toEqual(['right', 'left'])
    expect(nearestSides(box(0, 0), box(-100, 0))).toEqual(['left', 'right'])
    expect(nearestSides(box(0, 0), box(0, -100))).toEqual(['top', 'bottom'])
  })

  it('macht aus Text eine einzelne Karte', () => {
    expect(canvasWithText('  ')).toEqual({ nodes: [], edges: [] })
    const data = canvasWithText('# Titel\nText')
    expect(data.nodes).toEqual([expect.objectContaining({ type: 'text', text: '# Titel\nText' })])
  })
})
