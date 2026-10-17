'use client'
import { useRef, useState } from 'react'
import { usePref } from '@/shared/client/prefs'
import { dragPoint, formatPoint, parsePoint, pointStyle, type Point } from '../floating'

// Erst ab ein paar Pixeln ist es Ziehen – sonst ein Klick
const DRAG_THRESHOLD = 4

type DragStart = { pointerId: number; x: number; y: number; origin: Point; freeW: number; freeH: number }

/**
 * Verschieben eines schwebenden Elements mit Maus und Finger; die Position wird pro Gerät gemerkt.
 * Das Element trägt `data-floating` und liegt direkt in der Ebene, über die es sich bewegt.
 * Elemente mit `data-no-drag` (z. B. „Schließen“) starten kein Ziehen.
 */
export function useFloating(key: string, fallback: Point) {
  const [stored, setStored] = usePref(key, formatPoint(fallback))
  const [dragging, setDragging] = useState<Point | null>(null)
  const start = useRef<DragStart | null>(null)
  const last = useRef<Point | null>(null)
  const point = dragging ?? parsePoint(stored, fallback)

  const end = () => {
    if (!start.current) return
    start.current = null
    if (last.current) setStored(formatPoint(last.current))
    last.current = null
    setDragging(null)
  }

  const dragHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || (e.target as Element).closest('[data-no-drag]')) return
      const el = e.currentTarget.closest<HTMLElement>('[data-floating]')
      const layer = el?.parentElement
      if (!el || !layer) return
      const box = el.getBoundingClientRect()
      const area = layer.getBoundingClientRect()
      start.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        origin: point,
        freeW: area.width - box.width,
        freeH: area.height - box.height,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = start.current
      if (!s || s.pointerId !== e.pointerId) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      if (!last.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      last.current = dragPoint(s.origin, dx, dy, s.freeW, s.freeH)
      setDragging(last.current)
    },
    onPointerUp: end,
    onPointerCancel: end,
  }

  return { style: pointStyle(point), dragHandlers }
}
