// Canvas mit der Tastatur: was eine Pfeiltaste bewirkt, welche Karte sie trifft und wie sich Karten dabei ändern –
// ohne React, damit es sich in Node prüfen lässt
import { MIN_NODE_SIZE, nodesInGroup, type CanvasNode } from './canvas'
import { isFileTarget, makeExcerpt } from '@/shared/markdown/meta'
import { directionOf, nearestInDirection, nearestTo, type Box, type Direction } from '@/shared/lib/spatial'

/** Schritt in px beim Verschieben und Ändern der Größe; mit Umschalt der große Schritt */
const STEP = 20
const BIG_STEP = 100

const OFFSET: Record<Direction, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }

/** Richtung als Wort für Ansagen („nach rechts verschoben“, „keine Karte weiter oben“) */
export const DIRECTION_WORD: Record<Direction, string> = { left: 'links', right: 'rechts', up: 'oben', down: 'unten' }

export type ArrowCommand = { action: 'select' | 'move' | 'resize'; dir: Direction; step: number }

type Keys = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>

/**
 * Pfeiltaste auswerten: ohne Zusatztaste wählen, mit Alt verschieben, mit Strg/⌘ die Größe ändern – mit Umschalt in
 * großen Schritten. Strg+Alt+Pfeil bleibt frei: Damit wechseln Linux die Arbeitsfläche und Chrome auf dem Mac den Tab.
 */
export function arrowCommand(e: Keys): ArrowCommand | null {
  const dir = directionOf(e.key)
  if (!dir) return null
  const mod = e.ctrlKey || e.metaKey
  const step = e.shiftKey ? BIG_STEP : STEP
  if (e.altKey && !mod) return { action: 'move', dir, step }
  if (mod && !e.altKey) return { action: 'resize', dir, step }
  if (!e.altKey && !mod && !e.shiftKey) return { action: 'select', dir, step: 0 }
  return null
}

type Point = { x: number; y: number }
type FlowNode = { id: string; position: Point; measured?: { width?: number; height?: number } }

/** Lage der Karten, wie React Flow sie zeichnet (Canvas-Koordinaten) */
export function toBoxes(nodes: readonly FlowNode[]): Box[] {
  return nodes.map((n) => {
    const { width = 0, height = 0 } = n.measured ?? {}
    return { id: n.id, x: n.position.x, y: n.position.y, width, height }
  })
}

/** Karte, die eine Pfeiltaste wählt: die nächste in der Richtung – ohne Auswahl die nächste zur Bildmitte `center` */
export function nextCard(boxes: Box[], fromId: string | null, dir: Direction, center: Point): Box | null {
  const from = fromId ? boxes.find((b) => b.id === fromId) : undefined
  return from ? nearestInDirection(from, boxes, dir) : nearestTo(center, boxes)
}

/** Ziel beim Verbinden: vom bisherigen Ziel (anfangs der Quelle) aus weiter in der Richtung – nie die Quelle selbst */
export function nextTarget(boxes: Box[], sourceId: string, targetId: string | null, dir: Direction): Box | null {
  const from = boxes.find((b) => b.id === (targetId ?? sourceId))
  return from ? nearestInDirection(from, boxes.filter((b) => b.id !== sourceId), dir) : null
}

/** Stelle einer Karte in Lesereihenfolge (von oben nach unten, dann von links nach rechts), ab 1 */
export function readingIndex(boxes: Box[], id: string): number {
  return [...boxes].sort((a, b) => a.y - b.y || a.x - b.x).findIndex((b) => b.id === id) + 1
}

/** Ausgewählte Karten verschieben – eine Gruppe nimmt wie beim Ziehen die Karten mit, die in ihr liegen */
export function moveNodes(nodes: CanvasNode[], ids: ReadonlySet<string>, dir: Direction, step: number): CanvasNode[] {
  const [dx, dy] = OFFSET[dir]
  const moving = new Set(ids)
  for (const n of nodes) {
    if (ids.has(n.id) && n.type === 'group') for (const m of nodesInGroup(nodes, n)) moving.add(m.id)
  }
  return nodes.map((n) => (moving.has(n.id) ? { ...n, x: n.x + dx * step, y: n.y + dy * step } : n))
}

/** Größe ändern: nach rechts bzw. unten größer, nach links bzw. oben kleiner – nie unter die Mindestgröße (Rahmen) */
export function resizeNode(node: CanvasNode, dir: Direction, step: number): CanvasNode {
  const [dx, dy] = OFFSET[dir]
  const width = Math.max(MIN_NODE_SIZE, node.width + dx * step)
  const height = Math.max(MIN_NODE_SIZE, node.height + dy * step)
  return width === node.width && height === node.height ? node : { ...node, width, height }
}

const clip = (s: string) => (s.length > 60 ? `${s.slice(0, 59).trimEnd()}…` : s)

/** Name einer Karte für Bildschirmleser: Art und Anfang des Inhalts, z. B. Textkarte „Wärme Energie, die …“ */
export function cardLabel(node: CanvasNode): string {
  switch (node.type) {
    case 'text': {
      const text = makeExcerpt(node.text, 60)
      return text ? `Textkarte „${text}“` : 'Leere Textkarte'
    }
    case 'file':
      return `${isFileTarget(node.file) ? 'Datei' : 'Notiz'} „${clip(node.file)}“`
    case 'link':
      return `Link „${clip(node.url)}“`
    case 'group':
      return node.label?.trim() ? `Gruppe „${clip(node.label.trim())}“` : 'Gruppe ohne Namen'
  }
}
