// Schwebende Elemente (Werkzeugleiste, Fenster): Die Position ist ein Anteil der freien Fläche – 0 = ganz links bzw.
// oben, 1 = ganz rechts bzw. unten. So bleibt ein Element bei jeder Fenstergröße ganz sichtbar und bleibt an dem Rand,
// an den man es geschoben hat.

export type Point = { x: number; y: number }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export function parsePoint(raw: string, fallback: Point): Point {
  const [x, y] = raw.split(',').map((s) => (s.trim() ? Number(s) : NaN))
  return Number.isFinite(x) && Number.isFinite(y) ? { x: clamp01(x), y: clamp01(y) } : fallback
}

export const formatPoint = (p: Point) => `${Number(p.x.toFixed(4))},${Number(p.y.toFixed(4))}`

/** CSS für ein absolut positioniertes Element: links = Anteil der Fläche minus derselbe Anteil der eigenen Breite */
export function pointStyle(p: Point): { left: string; top: string; transform: string } {
  return { left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: `translate(${-p.x * 100}%, ${-p.y * 100}%)` }
}

/** Position nach dem Ziehen um dx/dy Pixel; freeW/freeH: Fläche minus Größe des Elements */
export function dragPoint(origin: Point, dx: number, dy: number, freeW: number, freeH: number): Point {
  return {
    x: freeW > 0 ? clamp01(origin.x + dx / freeW) : origin.x,
    y: freeH > 0 ? clamp01(origin.y + dy / freeH) : origin.y,
  }
}

/** Mit den Pfeiltasten verschieben (mit Umschalt in großen Schritten); andere Tasten: null */
export function nudgePoint(p: Point, key: string, big: boolean): Point | null {
  const step = big ? 0.2 : 0.05
  switch (key) {
    case 'ArrowLeft':
      return { ...p, x: clamp01(p.x - step) }
    case 'ArrowRight':
      return { ...p, x: clamp01(p.x + step) }
    case 'ArrowUp':
      return { ...p, y: clamp01(p.y - step) }
    case 'ArrowDown':
      return { ...p, y: clamp01(p.y + step) }
    default:
      return null
  }
}
