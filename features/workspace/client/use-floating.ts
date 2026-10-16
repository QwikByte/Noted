'use client'
import { useRef, useState } from 'react'
import { usePref } from '@/shared/client/prefs'
import { dragPoint, formatPoint, nudgePoint, parsePoint, pointStyle, type Point } from '../floating'

// Erst ab ein paar Pixeln ist es Ziehen – sonst ein Klick
const DRAG_THRESHOLD = 4

type DragStart = { pointerId: number; x: number; y: number; origin: Point; freeW: number; freeH: number }

/**
 * Verschieben eines schwebenden Elements mit Maus, Finger und Pfeiltasten; die Position wird pro Gerät gemerkt.
 * Das Element trägt `data-floating` und liegt direkt in der Ebene, über die es sich bewegt.
 * Elemente mit `data-no-drag` (z. B. „Schließen“) starten kein Ziehen.
 */
export function useFloating(key: string, fallback: Point) {
  const [stored, setStored] = usePref(key, formatPoint(fallback))
  const [dragging, setDragging] = useState<Point | null>(null)
  const start = useRef<DragStart | null>(null)
  const last = useRef<Point | null>(null)
  const moved = useRef(false)
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
      moved.current = false
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = start.current
      if (!s || s.pointerId !== e.pointerId) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      if (!moved.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      moved.current = true
      last.current = dragPoint(s.origin, dx, dy, s.freeW, s.freeH)
      setDragging(last.current)
    },
    onPointerUp: end,
    onPointerCancel: end,
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const next = nudgePoint(point, e.key, e.shiftKey)
    if (!next) return
    e.preventDefault()
    setStored(formatPoint(next))
  }

  return {
    style: pointStyle(point),
    dragHandlers,
    onKeyDown,
    /** Für onClick: War das gerade ein Ziehen statt eines Klicks? Gilt nur für den Klick direkt danach. */
    wasDragged: () => {
      const dragged = moved.current
      moved.current = false
      return dragged
    },
  }
}
