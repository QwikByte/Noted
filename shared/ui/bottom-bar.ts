'use client'
import { useCallback } from 'react'

/**
 * Für eine feste Leiste am unteren Rand (z. B. die Bewertungsknöpfe beim Lernen): Ihre Höhe steht in der
 * CSS-Variable --bottom-bar-height, damit schwebende Elemente wie die Werkzeugleiste darüber bleiben.
 */
export function useBottomBar<T extends HTMLElement>() {
  return useCallback((el: T | null) => {
    if (!el) return
    const root = document.documentElement
    const observer = new ResizeObserver(() => root.style.setProperty('--bottom-bar-height', `${el.offsetHeight}px`))
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--bottom-bar-height')
    }
  }, [])
}
