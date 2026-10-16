'use client'
import { useSyncExternalStore } from 'react'

/** Ob eine Media-Query zutrifft (z. B. „breiter Bildschirm“) – auf dem Server und beim ersten Rendern: nein */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (fn) => {
      const mq = matchMedia(query)
      mq.addEventListener('change', fn)
      return () => mq.removeEventListener('change', fn)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}
