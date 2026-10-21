// Tastatur im Graphen: mit den Pfeiltasten von Notiz zu Notiz wandern. Reine Logik ohne DOM – welche Notiz in einer
// Richtung als Nächstes kommt, entscheiden die Helfer in shared/lib/spatial.ts.
import { nearestInDirection, nearestTo, type Box, type Direction } from '@/shared/lib/spatial'

/** Sichtbarer Ausschnitt: Verschiebung und Zoom von React Flow, dazu die Größe der Fläche in Pixeln */
export type View = { x: number; y: number; zoom: number; width: number; height: number }

/** Mitte des sichtbaren Ausschnitts in Koordinaten des Graphen */
export function viewCenter(v: View): { x: number; y: number } {
  return { x: (v.width / 2 - v.x) / v.zoom, y: (v.height / 2 - v.y) / v.zoom }
}

/**
 * Liegt die Notiz nicht ganz im Ausschnitt? `margin` (Pixel) lässt Platz für den Titel unter dem Punkt und den
 * Fokusring – eine Notiz direkt am Rand gilt schon als draußen.
 */
export function outsideView(b: Box, v: View, margin = 32): boolean {
  const left = b.x * v.zoom + v.x
  const top = b.y * v.zoom + v.y
  return (
    left < margin || top < margin || left + b.width * v.zoom > v.width - margin || top + b.height * v.zoom > v.height - margin
  )
}

/**
 * Notizen, zwischen denen die Pfeiltasten wechseln: Während einer Suche nur die Treffer, die übrigen sind dann
 * abgeblendet. Findet die Suche nichts, alle – sonst liefen die Tasten ins Leere.
 */
export function keyTargets(boxes: Box[], matches: ReadonlySet<string>): Box[] {
  const hits = boxes.filter((b) => matches.has(b.id))
  return hits.length > 0 ? hits : boxes
}

/**
 * Ziel einer Pfeiltaste unter `targets`. Ohne Tastaturfokus – oder wenn die bisherige Notiz nicht mehr dazugehört,
 * etwa nach einer neuen Suche – beginnt es bei `start`: der Notiz `start.id` (Mitte des lokalen Graphen), sonst der
 * Notiz nahe `start.point` (Mitte des sichtbaren Ausschnitts). null: In der Richtung liegt keine Notiz mehr.
 */
export function nextFocus(
  targets: Box[],
  current: string | null,
  dir: Direction,
  start: { id?: string; point: { x: number; y: number } },
): Box | null {
  const from = current === null ? undefined : targets.find((b) => b.id === current)
  if (from) return nearestInDirection(from, targets, dir)
  return targets.find((b) => b.id === start.id) ?? nearestTo(start.point, targets)
}

/** Ansage für Bildschirmleser: Titel und Zahl der Verbindungen; die Notiz in der Mitte des lokalen Graphen als solche */
export function describeNode(node: { title: string; links: number }, isCenter: boolean): string {
  const links =
    node.links === 0 ? 'keine Verbindungen'
    : node.links === 1 ? '1 Verbindung'
    : `${node.links.toLocaleString('de-DE')} Verbindungen`
  return `${node.title}${isCenter ? ' (diese Notiz)' : ''}, ${links}`
}
