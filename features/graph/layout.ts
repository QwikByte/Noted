// Anordnung der Graph-Ansicht: kleine kräftebasierte Simulation (Abstoßung zwischen allen Knoten, Federn entlang der
// Kanten, Zug zur Mitte). Reine Logik ohne DOM – läuft im Browser und in den Tests.

export type Point = { x: number; y: number }

type Edge = { source: string; target: string }

export type LayoutOptions = {
  /** Fläche, auf die der Graph verteilt wird (Standard: wächst mit der Zahl der Knoten) */
  width?: number
  height?: number
  iterations?: number
}

/** Stabiler Hash (FNV-1a) – derselbe Knoten startet immer an derselben Stelle */
function hash(text: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0xffffffff
}

const EMPTY = -1
const INTERNAL = -2
/** Kleinere Zellen werden nicht mehr geteilt – übereinanderliegende Knoten teilen sich dann eine Zelle */
const MIN_HALF = 1e-3
/** Barnes-Hut: Zellen, die von weitem kleiner als dieser Winkel erscheinen, wirken als ein Punkt */
const THETA2 = 0.8 * 0.8

/**
 * Quadtree für die Abstoßung (Barnes-Hut): Weit entfernte Gruppen von Knoten wirken wie ein Knoten in ihrem
 * Schwerpunkt. So wächst der Aufwand mit n·log n statt mit n² – 1 000 Knoten brauchen deutlich unter einer Sekunde.
 */
class QuadTree {
  private size = 0
  private capacity = 0
  private midX = new Float64Array(0)
  private midY = new Float64Array(0)
  private half = new Float64Array(0)
  private mass = new Float64Array(0)
  private sumX = new Float64Array(0)
  private sumY = new Float64Array(0)
  /** Erster Knoten einer Blattzelle, EMPTY oder INTERNAL */
  private body = new Int32Array(0)
  private children = new Int32Array(0)
  /** Weitere Knoten in derselben (kleinsten) Zelle */
  private next: Int32Array
  private stack = new Int32Array(0)

  constructor(n: number) {
    this.next = new Int32Array(n)
    this.grow(4 * n + 64)
  }

  private grow(capacity: number) {
    const copy = <T extends Float64Array | Int32Array>(old: T, size: number): T => {
      const next = new (old.constructor as new (n: number) => T)(size)
      next.set(old)
      return next
    }
    this.midX = copy(this.midX, capacity)
    this.midY = copy(this.midY, capacity)
    this.half = copy(this.half, capacity)
    this.mass = copy(this.mass, capacity)
    this.sumX = copy(this.sumX, capacity)
    this.sumY = copy(this.sumY, capacity)
    this.body = copy(this.body, capacity)
    this.children = copy(this.children, 4 * capacity)
    this.stack = new Int32Array(4 * capacity)
    this.capacity = capacity
  }

  private cell(midX: number, midY: number, half: number): number {
    if (this.size === this.capacity) this.grow(this.capacity * 2)
    const c = this.size++
    this.midX[c] = midX
    this.midY[c] = midY
    this.half[c] = half
    this.mass[c] = 0
    this.sumX[c] = 0
    this.sumY[c] = 0
    this.body[c] = EMPTY
    this.children.fill(-1, 4 * c, 4 * c + 4)
    return c
  }

  private child(c: number, px: number, py: number): number {
    const q = (px >= this.midX[c] ? 1 : 0) + (py >= this.midY[c] ? 2 : 0)
    let ch = this.children[4 * c + q]
    if (ch === -1) {
      const h = this.half[c] / 2
      ch = this.cell(this.midX[c] + (q & 1 ? h : -h), this.midY[c] + (q & 2 ? h : -h), h)
      this.children[4 * c + q] = ch
    }
    return ch
  }

  build(x: Float64Array, y: Float64Array) {
    this.size = 0
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < x.length; i++) {
      if (x[i] < minX) minX = x[i]
      if (x[i] > maxX) maxX = x[i]
      if (y[i] < minY) minY = y[i]
      if (y[i] > maxY) maxY = y[i]
    }
    const half = Math.max(maxX - minX, maxY - minY) / 2 + 1
    this.cell((minX + maxX) / 2, (minY + maxY) / 2, half)
    for (let i = 0; i < x.length; i++) this.insert(i, x, y)
  }

  private insert(i: number, x: Float64Array, y: Float64Array) {
    let c = 0
    for (;;) {
      this.mass[c]++
      this.sumX[c] += x[i]
      this.sumY[c] += y[i]
      const first = this.body[c]
      if (first === EMPTY) {
        this.body[c] = i
        this.next[i] = -1
        return
      }
      if (first >= 0) {
        if (this.half[c] < MIN_HALF) {
          this.next[i] = first
          this.body[c] = i
          return
        }
        // Blatt teilen: der bisherige Knoten wandert eine Ebene tiefer
        this.body[c] = INTERNAL
        const leaf = this.child(c, x[first], y[first])
        this.body[leaf] = first
        this.next[first] = -1
        this.mass[leaf] = 1
        this.sumX[leaf] = x[first]
        this.sumY[leaf] = y[first]
      }
      c = this.child(c, x[i], y[i])
    }
  }

  /** Abstoßung aller anderen Knoten auf Knoten i aufsummieren */
  repel(i: number, x: Float64Array, y: Float64Array, k2: number, dx: Float64Array, dy: Float64Array) {
    const stack = this.stack
    const xi = x[i]
    const yi = y[i]
    let fx = 0
    let fy = 0
    let top = 0
    stack[top++] = 0
    while (top > 0) {
      const c = stack[--top]
      const mass = this.mass[c]
      if (mass === 0) continue
      const first = this.body[c]
      if (first >= 0) {
        for (let b = first; b !== -1; b = this.next[b]) {
          if (b === i) continue
          let ddx = xi - x[b]
          let ddy = yi - y[b]
          let d2 = ddx * ddx + ddy * ddy
          if (d2 < 0.01) {
            // Übereinanderliegende Knoten in eine feste Richtung auseinanderschieben
            ddx = i < b ? -0.1 : 0.1
            ddy = ((i + b) % 3) * 0.05
            d2 = ddx * ddx + ddy * ddy
          }
          // Kraft k²/d in Richtung (ddx, ddy)/d
          const f = k2 / d2
          fx += ddx * f
          fy += ddy * f
        }
        continue
      }
      const ddx = xi - this.sumX[c] / mass
      const ddy = yi - this.sumY[c] / mass
      const d2 = ddx * ddx + ddy * ddy
      const size = 2 * this.half[c]
      if (size * size < THETA2 * d2) {
        const f = (mass * k2) / d2
        fx += ddx * f
        fy += ddy * f
        continue
      }
      const base = 4 * c
      for (let q = 0; q < 4; q++) {
        const ch = this.children[base + q]
        if (ch !== -1) stack[top++] = ch
      }
    }
    dx[i] += fx
    dy[i] += fy
  }
}

/**
 * Positionen (Mittelpunkte) für alle Knoten. Gleiche Eingabe ergibt immer dieselben Positionen – unabhängig von
 * der Reihenfolge der Knoten und Kanten.
 */
export function layoutGraph(
  nodes: readonly { id: string }[],
  edges: readonly Edge[],
  opts: LayoutOptions = {},
): Map<string, Point> {
  const ids = [...new Set(nodes.map((n) => n.id))].sort()
  const n = ids.length
  const result = new Map<string, Point>()
  const side = Math.max(200, Math.sqrt(n) * 110)
  const width = opts.width ?? side
  const height = opts.height ?? side
  const cx = width / 2
  const cy = height / 2
  if (n === 0) return result
  if (n === 1) return result.set(ids[0], { x: cx, y: cy })

  const index = new Map(ids.map((id, i) => [id, i]))
  const pairs = new Set<string>()
  const springs: number[] = []
  for (const e of [...edges].sort((a, b) => (a.source + a.target < b.source + b.target ? -1 : 1))) {
    const a = index.get(e.source)
    const b = index.get(e.target)
    if (a === undefined || b === undefined || a === b) continue
    // Gegenseitige Links ziehen nicht doppelt so stark
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (pairs.has(key)) continue
    pairs.add(key)
    springs.push(a, b)
  }

  const x = new Float64Array(n)
  const y = new Float64Array(n)
  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  // Start: gleichmäßig zufällig verteilt auf einer Scheibe – der Zufall kommt aus der ID
  const radius = Math.min(width, height) / 2
  for (let i = 0; i < n; i++) {
    const r = radius * Math.sqrt(hash(ids[i], 1))
    const angle = 2 * Math.PI * hash(ids[i], 2)
    x[i] = cx + r * Math.cos(angle)
    y[i] = cy + r * Math.sin(angle)
  }

  // Idealer Abstand zwischen zwei Knoten (Fruchterman-Reingold)
  const k = Math.sqrt((width * height) / n)
  const k2 = k * k
  const gravity = 0.05
  const iterations = opts.iterations ?? 150
  let temperature = radius / 4
  const cooling = temperature / (iterations + 1)

  const tree = new QuadTree(n)
  for (let it = 0; it < iterations; it++) {
    dx.fill(0)
    dy.fill(0)
    tree.build(x, y)
    for (let i = 0; i < n; i++) tree.repel(i, x, y, k2, dx, dy)
    for (let s = 0; s < springs.length; s += 2) {
      const a = springs[s]
      const b = springs[s + 1]
      const ddx = x[a] - x[b]
      const ddy = y[a] - y[b]
      // Kraft d²/k in Richtung (ddx, ddy)/d
      const f = Math.sqrt(ddx * ddx + ddy * ddy) / k
      dx[a] -= ddx * f
      dy[a] -= ddy * f
      dx[b] += ddx * f
      dy[b] += ddy * f
    }
    for (let i = 0; i < n; i++) {
      // Zug zur Mitte hält unverbundene Inseln zusammen
      dx[i] -= (x[i] - cx) * gravity * (k / 10)
      dy[i] -= (y[i] - cy) * gravity * (k / 10)
      const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i])
      if (len > 0) {
        const step = Math.min(len, temperature) / len
        x[i] += dx[i] * step
        y[i] += dy[i] * step
      }
    }
    temperature -= cooling
  }

  for (let i = 0; i < n; i++) result.set(ids[i], { x: x[i], y: y[i] })
  return result
}

/**
 * Ausschnitt um einen Knoten: alle Knoten, die über höchstens `depth` Kanten erreichbar sind (Richtung egal), und die
 * Kanten zwischen ihnen. Für den lokalen Graphen einer Notiz.
 */
export function neighborhood<N extends { id: string }, E extends Edge>(
  graph: { nodes: readonly N[]; edges: readonly E[] },
  id: string,
  depth: number,
): { nodes: N[]; edges: E[] } {
  if (!graph.nodes.some((n) => n.id === id)) return { nodes: [], edges: [] }
  const adjacent = new Map<string, string[]>()
  const link = (a: string, b: string) => {
    const list = adjacent.get(a)
    if (list) list.push(b)
    else adjacent.set(a, [b])
  }
  for (const e of graph.edges) {
    link(e.source, e.target)
    link(e.target, e.source)
  }
  const seen = new Set([id])
  let frontier = [id]
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = []
    for (const current of frontier) {
      for (const other of adjacent.get(current) ?? []) {
        if (seen.has(other)) continue
        seen.add(other)
        next.push(other)
      }
    }
    frontier = next
  }
  return {
    nodes: graph.nodes.filter((n) => seen.has(n.id)),
    edges: graph.edges.filter((e) => seen.has(e.source) && seen.has(e.target)),
  }
}
