'use client'
import { AlertTriangle, Calendar, Hash, List, Text } from 'lucide-react'

function isDateLike(v: unknown) {
  return v instanceof Date || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (v instanceof Date) return v.toLocaleDateString('de-DE')
  if (typeof v === 'boolean') return v ? 'Ja' : 'Nein'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Properties (YAML-Frontmatter) als übersichtliche Tabelle. */
export function Properties({
  data,
  error,
  onOpenTag,
}: {
  data: Record<string, unknown> | null
  error: boolean
  onOpenTag: (tag: string) => void
}) {
  if (error) {
    return (
      <div className="mb-6 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 font-sans text-sm text-warning">
        <AlertTriangle className="size-4" /> Die Properties (YAML) enthalten einen Fehler.
      </div>
    )
  }
  const entries = Object.entries(data ?? {})
  if (entries.length === 0) return null
  return (
    <div className="not-prose mb-6 rounded-lg border border-border bg-subtle/60 px-3 py-2 font-sans text-sm">
      <div className="mb-1 text-xs font-semibold text-faint">Properties</div>
      <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-1.5">
        {entries.map(([key, value]) => {
          const isTags = ['tags', 'tag'].includes(key.toLowerCase())
          const list = Array.isArray(value) ? value : isTags && typeof value === 'string' ? value.split(/[,\s]+/) : null
          const Icon = isTags ? Hash : list ? List : isDateLike(value) ? Calendar : Text
          return (
            <div key={key} className="contents">
              <dt className="flex min-w-0 items-center gap-1.5 truncate py-0.5 text-muted">
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{key}</span>
              </dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-1.5 py-0.5">
                {list ? (
                  list.length === 0 ? (
                    <span className="text-faint">—</span>
                  ) : (
                    list.filter((x) => x !== null && x !== '').map((item, i) =>
                      isTags ? (
                        <a
                          key={i}
                          href={`/?t=${encodeURIComponent(String(item).replace(/^#/, '').toLowerCase())}`}
                          className="tag"
                          onClick={(e) => {
                            // Strg/⌘-Klick und Mittelklick öffnen den Tag wie jeder Link in einem neuen Tab
                            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                            e.preventDefault()
                            onOpenTag(String(item).replace(/^#/, '').toLowerCase())
                          }}
                        >
                          #{String(item).replace(/^#/, '')}
                        </a>
                      ) : (
                        <span key={i} className="rounded-md bg-elevated px-1.5 py-0.5 text-[13px]">
                          {formatValue(item)}
                        </span>
                      ),
                    )
                  )
                ) : (
                  <span className={value === null || value === '' ? 'text-faint' : ''}>{formatValue(value)}</span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
