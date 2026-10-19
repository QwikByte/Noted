import { describe, expect, it } from 'vitest'
import { layoutGraph, neighborhood } from './layout'

const ids = (n: number, prefix = 'n') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${String(i).padStart(4, '0')}` }))

/** Reproduzierbare Pseudozufallszahlen für Testgraphen */
function random(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}

function randomEdges(nodes: { id: string }[], count: number, seed = 1) {
  const rnd = random(seed)
  return Array.from({ length: count }, () => ({
    source: nodes[Math.floor(rnd() * nodes.length)].id,
    target: nodes[Math.floor(rnd() * nodes.length)].id,
  }))
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('layoutGraph', () => {
  it('ist deterministisch – auch bei anderer Reihenfolge der Eingabe', () => {
    const nodes = ids(60)
    const edges = randomEdges(nodes, 90)
    const first = layoutGraph(nodes, edges)
    expect(layoutGraph(nodes, edges)).toEqual(first)
    expect(layoutGraph([...nodes].reverse(), [...edges].reverse())).toEqual(first)
  })

  it('liefert für jeden Knoten eine endliche Position, auch in Randfällen', () => {
    expect(layoutGraph([], [])).toEqual(new Map())
    expect([...layoutGraph([{ id: 'a' }], []).values()]).toEqual([{ x: 100, y: 100 }])
    const nodes = [...ids(30), { id: 'n0001' }] // doppelte ID
    const edges = [
      ...randomEdges(ids(30), 40),
      { source: 'n0002', target: 'n0002' },
      { source: 'n0003', target: 'fehlt' },
    ]
    const pos = layoutGraph(nodes, edges, { iterations: 300 })
    expect(pos.size).toBe(30)
    for (const p of pos.values()) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
    // Keine zwei Knoten bleiben übereinander liegen
    const points = [...pos.values()]
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) expect(distance(points[i], points[j])).toBeGreaterThan(1)
    }
  })

  it('zieht verbundene Knoten zusammen und hält unverbundene auseinander', () => {
    const nodes = ids(40)
    // Zwei Gruppen, jeweils ringförmig verbunden
    const edges = nodes.map((n, i) => ({ source: n.id, target: nodes[i < 20 ? (i + 1) % 20 : 20 + ((i - 19) % 20)].id }))
    const pos = layoutGraph(nodes, edges)
    const mean = (pairs: [number, number][]) =>
      pairs.reduce((sum, [a, b]) => sum + distance(pos.get(nodes[a].id)!, pos.get(nodes[b].id)!), 0) / pairs.length
    const linked = mean(edges.map((_, i) => [i, i < 20 ? (i + 1) % 20 : 20 + ((i - 19) % 20)]))
    const across = mean(Array.from({ length: 20 }, (_, i) => [i, 20 + i]))
    expect(linked).toBeLessThan(across / 2)
  })

  it('ordnet 1 000 Knoten mit 3 000 Kanten in unter einer Sekunde an', () => {
    const nodes = ids(1000)
    const edges = randomEdges(nodes, 3000, 7)
    const start = performance.now()
    const pos = layoutGraph(nodes, edges)
    expect(performance.now() - start).toBeLessThan(1000)
    expect(pos.size).toBe(1000)
  })
})

describe('neighborhood', () => {
  // a → b → c → d, e ← b, f allein
  const graph = {
    nodes: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id })),
    edges: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
      { source: 'e', target: 'b' },
    ],
  }
  const names = (g: { nodes: { id: string }[] }) => g.nodes.map((n) => n.id)

  it('Tiefe 1: ein- und ausgehende Links samt Kanten zwischen ihnen', () => {
    const g = neighborhood(graph, 'b', 1)
    expect(names(g)).toEqual(['a', 'b', 'c', 'e'])
    expect(g.edges).toEqual([graph.edges[0], graph.edges[1], graph.edges[3]])
  })

  it('Tiefe 2 und unbekannte oder unverbundene Knoten', () => {
    expect(names(neighborhood(graph, 'a', 2))).toEqual(['a', 'b', 'c', 'e'])
    expect(names(neighborhood(graph, 'a', 3))).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(neighborhood(graph, 'f', 2)).toEqual({ nodes: [{ id: 'f' }], edges: [] })
    expect(neighborhood(graph, 'x', 1)).toEqual({ nodes: [], edges: [] })
  })
})
