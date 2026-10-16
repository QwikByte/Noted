'use client'
import { useSyncExternalStore } from 'react'
import { CloudOff, RefreshCw } from 'lucide-react'
import { useDrafts } from '@/lib/client/queries'
import { sync } from '@/lib/client/sync'

function subscribeOnline(fn: () => void) {
  window.addEventListener('online', fn)
  window.addEventListener('offline', fn)
  return () => {
    window.removeEventListener('online', fn)
    window.removeEventListener('offline', fn)
  }
}

function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  )
}

/** Zeigt an, ob es noch nicht synchronisierte Änderungen gibt oder das Gerät offline ist. */
export function SyncBadge() {
  const drafts = useDrafts()
  const online = useOnline()
  const offlineDrafts = drafts.filter((d) => sync.getStatus(d.id).state === 'offline').length

  if (!online || offlineDrafts > 0) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning"
        title={`${drafts.length} Änderung(en) lokal gesichert – werden automatisch synchronisiert`}
      >
        <CloudOff className="size-3.5" /> Offline{drafts.length ? ` · ${drafts.length}` : ''}
      </span>
    )
  }
  if (drafts.length > 0) {
    return (
      <button
        type="button"
        onClick={() => sync.flushAll()}
        className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-xs text-muted"
        title="Änderungen werden synchronisiert"
      >
        <RefreshCw className="size-3 animate-spin [animation-duration:2s]" /> {drafts.length}
      </button>
    )
  }
  return null
}
