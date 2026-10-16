import { describe, expect, it } from 'vitest'
import { convertContent } from './client/convert'
import { parseCanvas, serializeCanvas } from '@/features/canvas/canvas'

const MINDMAP = '---\nmindmap-plugin: basic\n---\n\n# Plan\n\n## Lesen\n- Skript\n\n## Üben\n'

describe('Umwandeln von und zu Mindmap und Canvas', () => {
  it('macht aus Markdown eine Mindmap und behält die Properties', async () => {
    const md = '---\ntags: [uni]\n---\n# Plan\n\n## Lesen\n- Skript\n\n## Üben'
    expect(await convertContent(md, 'markdown', 'mindmap', 'Titel')).toBe(
      '---\nmindmap-plugin: basic\ntags: [uni]\n---\n\n# Plan\n\n## Lesen\n- Skript\n\n## Üben\n',
    )
  })

  it('macht aus jeder Zeile eines einfachen Texts einen Punkt', async () => {
    expect(await convertContent('Milch\nBrot\n\nKäse', 'text', 'mindmap', 'Einkauf')).toBe(
      '---\nmindmap-plugin: basic\n---\n\n# Einkauf\n\n## Milch\n\n## Brot\n\n## Käse\n',
    )
  })

  it('wandelt eine Mindmap ohne Verlust in Markdown und Text zurück', async () => {
    expect(await convertContent(MINDMAP, 'mindmap', 'markdown', 'Plan')).toBe('# Plan\n\n## Lesen\n- Skript\n\n## Üben\n')
    expect(await convertContent(MINDMAP, 'mindmap', 'text', 'Plan')).toBe('# Plan\n\n## Lesen\n- Skript\n\n## Üben\n')
  })

  it('legt jeden Punkt einer Mindmap als Karte ab, die Äste als Linien ohne Pfeil', async () => {
    const data = parseCanvas(await convertContent(MINDMAP, 'mindmap', 'canvas', 'Plan'))!
    expect(data.nodes.map((n) => (n.type === 'text' ? n.text : ''))).toEqual(['# Plan', 'Lesen', 'Skript', 'Üben'])
    expect(data.edges).toHaveLength(3)
    expect(data.edges.every((e) => e.toEnd === 'none')).toBe(true)
    // Keine Karte verdeckt eine andere
    for (const a of data.nodes) {
      for (const b of data.nodes) {
        if (a === b) continue
        expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false)
      }
    }
  })

  it('stellt Canvas-Karten als Markdown hintereinander und Text auf eine Karte', async () => {
    const canvas = serializeCanvas({
      nodes: [
        { id: 'b', type: 'text', text: 'Unten', x: 0, y: 300, width: 100, height: 50 },
        { id: 'a', type: 'text', text: 'Oben', x: 0, y: 0, width: 100, height: 50 },
      ],
      edges: [],
    })
    expect(await convertContent(canvas, 'canvas', 'markdown', 'X')).toBe('Oben\n\nUnten')
    const mindmap = await convertContent(canvas, 'canvas', 'mindmap', 'Brett')
    expect(mindmap).toBe('---\nmindmap-plugin: basic\n---\n\n# Brett\n\n## Oben\n\n## Unten\n')
    const fromText = parseCanvas(await convertContent('# Titel\nText', 'markdown', 'canvas', 'X'))!
    expect(fromText.nodes).toEqual([expect.objectContaining({ type: 'text', text: '# Titel\nText' })])
    expect(parseCanvas(await convertContent('', 'markdown', 'canvas', 'X'))).toEqual({ nodes: [], edges: [] })
  })
})
