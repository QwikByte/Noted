'use client'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
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

  async function revoke(share: Share) {
    try {
      await revokeShare(qc, share.id)
      toast.success('Link widerrufen – er führt jetzt ins Leere.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (query.isLoading) return <p className="text-sm text-muted">Lädt …</p>
  if (query.error) return <p className="text-sm text-danger">{errorMessage(query.error)}</p>
  if (shares.length === 0) return <p className="text-sm text-muted">{empty}</p>
  return (
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
          <Button size="sm" variant="ghost" onClick={() => void revoke(s)}>
            Widerrufen
          </Button>
        </li>
      ))}
    </ul>
  )
}
