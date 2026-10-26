'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { currentOutlinePath, pageLabel, type OutlineEntry } from '../navigation'

/** Alle anfangs aufgeklappten Einträge (Lesezeichen mit positivem Count) */
function initiallyOpen(entries: OutlineEntry[], into = new Set<string>()): Set<string> {
  for (const e of entries) {
    if (e.open) into.add(e.path)
    initiallyOpen(e.items, into)
  }
  return into
}

/** Reiter „Inhalt“: Lesezeichen des PDFs als Baum, das aktuelle Kapitel hervorgehoben */
export default function PdfOutline({
  entries,
  labels,
  current,
  onSelect,
}: {
  /** null: wird noch geladen */
  entries: OutlineEntry[] | null
  labels: string[] | null
  current: number
  onSelect: (entry: OutlineEntry) => void
}) {
  const [open, setOpen] = useState<Set<string> | null>(null)
  const expanded = useMemo(() => open ?? initiallyOpen(entries ?? []), [open, entries])
  const path = useMemo(() => currentOutlinePath(entries ?? [], current), [entries, current])
  // Hervorgehoben ist der tiefste sichtbare Eintrag auf dem Weg zum aktuellen Kapitel
  const stop = path.findIndex((p) => !expanded.has(p))
  const highlighted = stop < 0 ? path[path.length - 1] : path[stop]
  const listRef = useRef<HTMLDivElement>(null)

  // Beim Öffnen das aktuelle Kapitel zeigen – danach nicht mehr, sonst spränge die Liste beim Blättern weg
  const scrolled = useRef(false)
  useEffect(() => {
    if (scrolled.current || !highlighted) return
    scrolled.current = true
    listRef.current?.querySelector('[aria-current="location"]')?.scrollIntoView({ block: 'center' })
  }, [highlighted])

  if (!entries) {
    return (
      <div className="flex flex-1 justify-center p-6">
        <Loader2 className="size-5 animate-spin text-faint" />
      </div>
    )
  }
  if (entries.length === 0) return <p className="flex-1 p-4 text-sm text-muted">Dieses PDF hat kein Inhaltsverzeichnis.</p>

  const toggle = (p: string) => {
    const next = new Set(expanded)
    if (!next.delete(p)) next.add(p)
    setOpen(next)
  }

  const list = (items: OutlineEntry[], depth: number) => (
    <ul>
      {items.map((e) => {
        const isOpen = expanded.has(e.path)
        return (
          <li key={e.path}>
            <div
              className={cn('flex items-start rounded-lg hover:bg-hover', e.path === highlighted && 'bg-active')}
              style={{ paddingLeft: depth * 12 }}
            >
              {e.items.length ? (
                <button
                  type="button"
                  onClick={() => toggle(e.path)}
                  aria-expanded={isOpen}
                  aria-label={`${e.title} ${isOpen ? 'zuklappen' : 'aufklappen'}`}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-faint hover:text-fg"
                >
                  <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
                </button>
              ) : (
                <span className="w-7 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => onSelect(e)}
                disabled={!e.dest && !e.url}
                aria-label={e.page ? `${e.title}, S. ${pageLabel(e.page, labels)}` : undefined}
                aria-current={e.path === highlighted ? 'location' : undefined}
                className="flex min-w-0 flex-1 items-baseline gap-2 py-1.5 pr-2 text-left text-sm disabled:cursor-default"
              >
                <span className="min-w-0 flex-1 break-words">{e.title}</span>
                {e.page ? <span className="shrink-0 text-xs text-faint tabular-nums">{pageLabel(e.page, labels)}</span> : null}
              </button>
            </div>
            {isOpen && e.items.length ? list(e.items, depth + 1) : null}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5" data-testid="pdf-outline">
      {list(entries, 0)}
    </div>
  )
}
