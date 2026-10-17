'use client'
import { useEffect, useState } from 'react'

/** Aktuelle Zeit, die sich regelmäßig aktualisiert (z. B. für „fällig“-Anzeigen oder „Heute“ nach Mitternacht) */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
