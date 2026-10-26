'use client'
import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { NetworkError } from '@/shared/client/api'
import { usePdfReferences } from '../client/references'

type Tab = 'page' | 'all'

const TABS: [Tab, string][] = [
  ['page', 'Diese Seite'],
  ['all', 'Ganzes PDF'],
]

/**
 * Seitenleiste „Notizen“: welche eigenen Notizen die offene Seite bzw. das PDF zitieren. Ein Klick auf den Titel öffnet
 * die Notiz (das PDF bleibt offen), einer auf eine Seitenzahl blättert dorthin.
 */
export default function PdfReferences({
  attachmentId,
  current,
  onOpenNote,
  onPage,
  onClose,
}: {
  attachmentId: string
  current: number
  onOpenNote: (id: string) => void
  onPage: (page: number) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('page')
  const { data, error, isLoading } = usePdfReferences(attachmentId, true)
  const notes = (data ?? []).filter((n) => tab === 'all' || n.pages.includes(current))

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-l border-border bg-bg @max-2xl:absolute @max-2xl:inset-y-0 @max-2xl:right-0 @max-2xl:z-10 @max-2xl:w-[min(18rem,100%)] @max-2xl:shadow-lg"
      aria-label="Notizen zu diesem PDF"
      data-testid="pdf-references"
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1 pl-1.5">
        <div className="flex flex-1 gap-0.5 rounded-lg bg-subtle p-0.5" role="tablist" aria-label="Notizen">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                tab === value ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Notizen schließen">
          <X className="size-4" />
        </Button>
      </div>
      {isLoading ? (
        <Loader2 className="mx-auto mt-6 size-5 animate-spin text-faint" />
      ) : error ? (
        <p className="p-4 text-sm text-muted">
          {error instanceof NetworkError
            ? 'Offline – die Verweise wurden auf diesem Gerät noch nicht geladen.'
            : 'Die Verweise konnten nicht geladen werden.'}
        </p>
      ) : notes.length === 0 ? (
        <p className="p-4 text-sm text-muted">
          {tab === 'page'
            ? `Keine Notiz verweist auf Seite ${current}. Einen Link auf diese Seite fügt der Knopf mit dem Kettensymbol oben ein.`
            : 'Keine Notiz bettet dieses PDF ein oder verlinkt es.'}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg px-2 py-1.5 hover:bg-hover">
              <button
                type="button"
                onClick={() => onOpenNote(n.id)}
                className="block w-full truncate text-left text-sm font-medium hover:text-accent-text"
              >
                {n.title}
              </button>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-xs text-muted">
                {n.pages.length ? (
                  <>
                    <span>S.</span>
                    {n.pages.map((p, i) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => onPage(p)}
                        aria-label={`Seite ${p}`}
                        aria-current={p === current ? 'page' : undefined}
                        className={cn('tabular-nums hover:text-fg hover:underline', p === current && 'font-semibold text-fg')}
                      >
                        {p}
                        {i < n.pages.length - 1 ? ',' : ''}
                      </button>
                    ))}
                  </>
                ) : null}
                {n.whole ? <span>{n.pages.length ? '· ganzes PDF' : 'Ganzes PDF'}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
