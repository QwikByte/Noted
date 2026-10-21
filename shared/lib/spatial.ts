// Mit den Pfeiltasten über Flächen wandern, auf denen Dinge frei liegen (Canvas, Graph): das nächste Element in einer
// Richtung finden – so, wie man es mit dem Auge erwartet.

export type Box = { id: string; x: number; y: number; width: number; height: number }
export type Direction = 'left' | 'right' | 'up' | 'down'

const DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

/** Richtung einer Pfeiltaste, sonst null */
export function directionOf(key: string): Direction | null {
  return DIRECTIONS[key] ?? null
}

const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })

/**
 * Nächstes Element in der Richtung, gemessen von Mitte zu Mitte. Es muss wirklich in dieser Richtung liegen; seitliche
 * Abweichung zählt doppelt, damit z. B. „rechts“ eher das Element auf gleicher Höhe trifft als ein näheres schräg darüber.
 */
export function nearestInDirection(from: Box, boxes: Box[], dir: Direction): Box | null {
  const a = center(from)
  let best: Box | null = null
  let bestScore = Infinity
  for (const b of boxes) {
    if (b.id === from.id) continue
    const c = center(b)
    const dx = c.x - a.x
    const dy = c.y - a.y
    const [along, across] = dir === 'left' ? [-dx, dy] : dir === 'right' ? [dx, dy] : dir === 'up' ? [-dy, dx] : [dy, dx]
    if (along <= 0) continue
    const score = along + 2 * Math.abs(across)
    if (score < bestScore) {
      bestScore = score
      best = b
    }
  }
  return best
}

/** Element, dessen Mitte am nächsten an einem Punkt liegt (z. B. der Mitte des sichtbaren Ausschnitts) */
export function nearestTo(point: { x: number; y: number }, boxes: Box[]): Box | null {
  let best: Box | null = null
  let bestDist = Infinity
  for (const b of boxes) {
    const c = center(b)
    const dist = Math.hypot(c.x - point.x, c.y - point.y)
    if (dist < bestDist) {
      bestDist = dist
      best = b
    }
  }
  return best
}
