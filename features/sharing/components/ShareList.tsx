'use client'
import { useState } from 'react'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { ConfirmModal } from '@/shared/ui/modal'
import { useToast } from '@/shared/ui/toast'
import { errorMessage } from '@/shared/client/api'
import { formatDateTime, formatRelative } from '@/shared/lib/format'
import { revokeShare } from '../client/queries'
import type { Share } from '../types'

/** Links mit Laufzeit und Aufrufen – `withTitle`: mit der Notiz (Übersicht in den Einstellungen) */
export function ShareList({ query, empty, withTitle }: { query: UseQueryResult<Share[]>; empty: string; withTitle?: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const shares = query.data ?? []
  const [toRevoke, setToRevoke] = useState<Share | null>(null)
  const [busy, setBusy] = useState(false)

  async function revoke(share: Share) {
    setBusy(true)
    try {
      await revokeShare(qc, share.id)
      toast.success('Link widerrufen – er führt jetzt ins Leere.')
      setToRevoke(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (query.isLoading) return <p className="text-sm text-muted">Lädt …</p>
  if (query.error) return <p className="text-sm text-danger">{errorMessage(query.error)}</p>
  if (shares.length === 0) return <p className="text-sm text-muted">{empty}</p>
  return (
    <>
      <ul className="divide-y divide-border" data-testid="share-list">
        {shares.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2.5 first:pt-0">
            <div className="min-w-0 flex-1">
              {withTitle ? (
                <p className="flex items-center gap-2 text-sm font-medium">
                  <a href={`/?n=${encodeURIComponent(s.noteId)}`} className="truncate hover:text-accent-text">
                    {s.noteTitle}
                  </a>
                  {s.noteTrashed ? <Badge tone="warning">Im Papierkorb</Badge> : null}
                </p>
              ) : null}
              <p className="text-xs text-faint">
                erstellt {formatRelative(s.createdAt)} · {s.expiresAt ? `gültig bis ${formatDateTime(s.expiresAt)}` : 'unbegrenzt gültig'} ·{' '}
                {s.opens === 0 ? 'noch nicht geöffnet' : `${s.opens}× geöffnet, zuletzt ${formatRelative(s.lastOpenedAt ?? s.createdAt)}`}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setToRevoke(s)}
              aria-label={`Link auf „${s.noteTitle}“ widerrufen`}
            >
              Widerrufen
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmModal
        open={!!toRevoke}
        onClose={() => setToRevoke(null)}
        title="Link widerrufen?"
        description={`Der Link auf „${toRevoke?.noteTitle ?? ''}“ führt danach ins Leere. Das lässt sich nicht rückgängig machen.`}
        confirmLabel="Widerrufen"
        danger
        loading={busy}
        onConfirm={() => toRevoke && void revoke(toRevoke)}
      />
    </>
  )
}
