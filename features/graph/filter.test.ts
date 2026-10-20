import { describe, expect, it } from 'vitest'
import { filterGraph, nodeSize, rootColors } from './filter'
import type { GraphData } from './types'

const node = (id: string, folderId: string | null, tags: string[] = []) => ({ id, title: id, folderId, tags, links: 0 })

const graph: GraphData = {
  nodes: [node('a', 'mathe', ['uni/mathe']), node('b', 'analysis', ['uni']), node('c', 'physik'), node('d', null, ['uni/physik'])],
  edges: [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'a' },
    { source: 'd', target: 'a' },
  ],
}
const ids = (g: GraphData) => g.nodes.map((n) => n.id)

describe('filterGraph', () => {
  it('Ordner mit Unterordnern: nur deren Notizen und die Kanten zwischen ihnen', () => {
    const g = filterGraph(graph, { folderIds: new Set(['mathe', 'analysis']), tag: null })
    expect(ids(g)).toEqual(['a', 'b'])
    expect(g.edges).toEqual([{ source: 'a', target: 'b' }])
  })

  it('Tag, auch verschachtelt, und beides zusammen', () => {
    expect(ids(filterGraph(graph, { folderIds: null, tag: 'uni' }))).toEqual(['a', 'b', 'd'])
    expect(ids(filterGraph(graph, { folderIds: null, tag: 'UNI/Physik' }))).toEqual(['d'])
    expect(ids(filterGraph(graph, { folderIds: new Set(['mathe']), tag: 'uni' }))).toEqual(['a'])
    expect(filterGraph(graph, { folderIds: null, tag: null })).toBe(graph)
  })
})

describe('Darstellung', () => {
  it('Knotengröße zwischen einfach und vierfach', () => {
    expect(nodeSize(0)).toBe(10)
    expect(nodeSize(4)).toBeCloseTo(22)
    expect(nodeSize(10_000)).toBe(40)
  })

  it('Farben der obersten Ordner alphabetisch und reihum', () => {
    const roots = ['Physik', 'analysis', 'Chemie', 'Bio', 'Deutsch', 'Englisch', 'Französisch'].map((name) => ({ id: name, name }))
    const colors = rootColors(roots)
    expect([...colors.entries()]).toEqual([
      ['analysis', 1],
      ['Bio', 2],
      ['Chemie', 3],
      ['Deutsch', 4],
      ['Englisch', 5],
      ['Französisch', 6],
      ['Physik', 1],
    ])
  })
})
