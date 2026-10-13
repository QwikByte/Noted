'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { applyUpdate, getServerUpdateState, getUpdateState, subscribeUpdate } from '@/lib/client/app-update'

/** Wie lange „Später“ den Hinweis ausblendet */
const SNOOZE_MS = 60 * 60_000

export function UpdateBanner() {
  const update = useSyncExternalStore(subscribeUpdate, getUpdateState, getServerUpdateState)
  const [snoozed, setSnoozed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!snoozed) return
    const timer = setTimeout(() => setSnoozed(false), SNOOZE_MS)
    return () => clearTimeout(timer)
  }, [snoozed])

  if (!update.available || snoozed) return null
  const version = update.version && update.version !== 'dev' ? ` (${update.version})` : ''
  return (
    <div
      className="pointer-events-auto flex w-full max-w-md animate-pop-in items-center gap-3 rounded-xl border border-border bg-elevated px-4 py-3 text-sm shadow-pop"
      role="status"
      data-testid="update-banner"
    >
      <RefreshCw className={busy ? 'size-4.5 shrink-0 animate-spin text-accent' : 'size-4.5 shrink-0 text-accent'} />
      <span className="flex-1">Neue Version verfügbar{version}</span>
      <button
        type="button"
        className="font-medium text-accent-text hover:underline disabled:opacity-60"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          applyUpdate()
        }}
      >
        Neu laden
      </button>
      <button type="button" onClick={() => setSnoozed(true)} className="text-faint hover:text-fg" aria-label="Später erinnern" title="Später">
        <X className="size-4" />
      </button>
    </div>
  )
}
