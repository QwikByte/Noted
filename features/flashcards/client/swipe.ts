'use client'
// Wischen auf der Karteikarte – nur mit dem Finger; Maus und Stift ändern nichts. Die Karte folgt dem Finger, wer unter
// der Schwelle loslässt, sieht sie zurückschnappen. Senkrechtes Scrollen übernimmt der Browser (touch-action: pan-y).
import { useRef, useState } from 'react'
import { isHorizontal, swipeDecision, type SwipeDirection } from '../swipe'

type Gesture = { id: number; x: number; y: number; width: number; still: boolean }
type Drag = { dx: number; dy: number; width: number; still: boolean }

/** Beginnt der Wisch dort, wo der Finger etwas anderes tut – in einem Eingabefeld oder waagerecht scrollbarem Inhalt? */
function busyTarget(target: EventTarget, root: HTMLElement): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return true
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true
  }
  return false
}

/**
 * `action(direction)`: was ein Wisch in diese Richtung auslöst (null = nichts, z. B. vor dem Aufdecken). Liefert die
 * Handler für die Karte, die Verschiebung beim Wischen und die Richtung, solange sie etwas auslösen würde.
 */
export function useSwipe<A extends { run: () => void }>(enabled: boolean, action: (direction: SwipeDirection) => A | null) {
  const gesture = useRef<Gesture | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const end = () => {
    gesture.current = null
    setDrag(null)
  }
  const handlers: React.HTMLAttributes<HTMLElement> = enabled
    ? {
        onPointerDown(e) {
          if (e.pointerType !== 'touch' || !e.isPrimary || busyTarget(e.target, e.currentTarget)) return
          // Markierter Text: Der Finger passt die Markierung an
          if (window.getSelection()?.isCollapsed === false) return
          gesture.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            width: e.currentTarget.getBoundingClientRect().width,
            still: matchMedia('(prefers-reduced-motion: reduce)').matches,
          }
        },
        onPointerMove(e) {
          const g = gesture.current
          if (g?.id !== e.pointerId) return
          setDrag({ dx: e.clientX - g.x, dy: e.clientY - g.y, width: g.width, still: g.still })
        },
        onPointerUp(e) {
          const g = gesture.current
          if (g?.id !== e.pointerId) return
          end()
          const direction = swipeDecision(e.clientX - g.x, e.clientY - g.y, g.width)
          if (direction) action(direction)?.run()
        },
        onPointerCancel: end,
      }
    : {}

  const horizontal = !!drag && isHorizontal(drag.dx, drag.dy)
  const direction: SwipeDirection | null = horizontal ? (drag.dx < 0 ? 'left' : 'right') : null
  return {
    handlers,
    /** Verschiebung der Karte in px – ohne Bewegung bei reduzierter Bewegung */
    offset: horizontal && !drag.still ? drag.dx : 0,
    dragging: !!drag,
    /** Was das Loslassen jetzt auslösen würde, und ob die Schwelle erreicht ist */
    preview: direction ? action(direction) : null,
    armed: !!drag && swipeDecision(drag.dx, drag.dy, drag.width) !== null,
  }
}
