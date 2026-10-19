'use client'
import { useMemo } from 'react'
import { usePref } from '@/shared/client/prefs'

/** Aufgeklappte Ordner in der Seitenleiste – auf dem Gerät gespeichert */
export function useExpanded() {
  const [raw, setRaw] = usePref<string>('noted:expanded', '[]')
  const set = useMemo(() => {
    try {
      return new Set<string>(JSON.parse(raw))
    } catch {
      return new Set<string>()
    }
  }, [raw])
  const toggle = (id: string, open?: boolean) => {
    const next = new Set(set)
    if (open ?? !next.has(id)) next.add(id)
    else next.delete(id)
    setRaw(JSON.stringify([...next]))
  }
  return { expanded: set, toggle }
}
