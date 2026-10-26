'use client'
// Vergleich zweier Fassungen: entfernte Zeilen mit „−“ und rot, hinzugefügte mit „+“ und grün – die Farbe ist nicht
// das einzige Merkmal, Screenreader hören „entfernt“ bzw. „hinzugefügt“
import { useMemo } from 'react'
import { cn } from '@/shared/ui/cn'
import { diffLines, diffRows } from '../diff'

export function DiffView({
  before,
  after,
  labels,
}: {
  before: string
  after: string
  /** Was „entfernt“ und „hinzugefügt“ hier heißt, z. B. „nur in der anderen Version“ */
  labels: { removed: string; added: string }
}) {
  const parts = useMemo(() => diffLines(before, after), [before, after])
  if (!parts) {
    return <p className="p-3 text-sm text-muted">Zu groß für einen Vergleich – die Fassungen unterscheiden sich zu stark.</p>
  }
  const removed = parts.filter((p) => p.kind === 'removed').reduce((n, p) => n + p.lines.length, 0)
  const added = parts.filter((p) => p.kind === 'added').reduce((n, p) => n + p.lines.length, 0)
  if (removed + added === 0) return <p className="p-3 text-sm text-muted">Keine Unterschiede im Text.</p>
  return (
    <div data-testid="diff-view">
      <p className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          <span className="font-semibold text-danger">−</span> {labels.removed} ({removed})
        </span>
        <span>
          <span className="font-semibold text-success">+</span> {labels.added} ({added})
        </span>
      </p>
      <div className="overflow-hidden rounded-lg border border-border font-mono text-xs leading-relaxed">
        {diffRows(parts).map((row, i) =>
          row.kind === 'skip' ? (
            <div key={i} className="bg-subtle px-3 py-1 text-faint italic">
              … {row.count} unveränderte {row.count === 1 ? 'Zeile' : 'Zeilen'}
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                'flex gap-2 px-3 whitespace-pre-wrap break-words',
                row.kind === 'removed' && 'bg-danger-soft text-danger',
                row.kind === 'added' && 'bg-success-soft text-success',
              )}
              data-kind={row.kind}
            >
              <span aria-hidden className="w-3 shrink-0 select-none">
                {row.kind === 'removed' ? '−' : row.kind === 'added' ? '+' : ' '}
              </span>
              {row.kind !== 'same' ? <span className="sr-only">{row.kind === 'removed' ? 'entfernt:' : 'hinzugefügt:'}</span> : null}
              <span className="min-w-0 flex-1">{row.text || ' '}</span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
