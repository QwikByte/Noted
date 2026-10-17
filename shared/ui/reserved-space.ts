'use client'
import { useCallback } from 'react'

/** Feste Bereiche, denen schwebende Elemente (Werkzeugleiste, Mini-Timer) ausweichen – jeweils eine CSS-Variable */
type ReservedSpace =
  /** Leiste über die ganze Breite am unteren Rand (z. B. Bewertungsknöpfe beim Lernen) */
  | '--bottom-bar-height'
  /** Knöpfe in der Ecke unten rechts (z. B. „Neue Notiz“ auf dem Handy, Zoom in Mindmap und Canvas) */
  | '--bottom-right-height'
  /** Seitenleiste am linken Rand */
  | '--sidebar-width'

/**
 * Meldet, wie weit ein fester Bereich vom unteren bzw. (Seitenleiste) linken Bildschirmrand hineinragt –
 * 0, solange er nicht zu sehen ist (z. B. per `lg:hidden`). Als `ref` an das Element hängen.
 */
export function useReservedSpace<T extends HTMLElement>(variable: ReservedSpace) {
  return useCallback(
    (el: T | null) => {
      if (!el) return
      const root = document.documentElement
      const measure = () => {
        const r = el.getBoundingClientRect()
        const visible = r.width > 0 && r.height > 0
        const space = !visible ? 0 : variable === '--sidebar-width' ? r.right : window.innerHeight - r.top
        root.style.setProperty(variable, `${Math.max(0, Math.round(space))}px`)
      }
      const observer = new ResizeObserver(measure)
      observer.observe(el)
      window.addEventListener('resize', measure)
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', measure)
        root.style.removeProperty(variable)
      }
    },
    [variable],
  )
}
