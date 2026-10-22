'use client'
// Gliederung der offenen Notiz: als Spalte links neben dem Blatt oder auf schmalen Flächen als Overlay darüber
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import type { OutlineEntry } from '../outline'
import type { NoteFormat } from '../types'

/** Ab dieser Breite des Notizbereichs steht die Gliederung als Spalte neben dem Blatt */
export const OUTLINE_BESIDE_WIDTH = 896

type OutlineNode = {
  entry: OutlineEntry
  index: number
  children: OutlineNode[]
}

/** Verschachtelte Listen, damit Screenreader die Ebene ansagen – die Tiefe steigt je Eintrag um höchstens eins */
function outlineTree(entries: OutlineEntry[]): OutlineNode[] {
  const roots: OutlineNode[] = []
  const path: OutlineNode[] = []
  entries.forEach((entry, index) => {
    const node: OutlineNode = { entry, index, children: [] }
    path.length = entry.depth
    ;(entry.depth === 0 ? roots : path[entry.depth - 1].children).push(node)
    path.push(node)
  })
  return roots
}

type EntriesProps = {
  nodes: OutlineNode[]
  current: number
  tabStop: number
  nested?: boolean
  onSelect: (entry: OutlineEntry, byKeyboard: boolean) => void
  onFocusEntry: (index: number) => void
}

function Entries({ nodes, current, tabStop, nested, onSelect, onFocusEntry }: EntriesProps) {
  return (
    <ul className={nested ? 'pl-3' : undefined}>
      {nodes.map(({ entry, index, children }) => (
        <li key={index}>
          <button
            type="button"
            data-index={index}
            tabIndex={index === tabStop ? 0 : -1}
            aria-current={index === current ? 'location' : undefined}
            title={entry.text}
            // detail 0: Auswahl per Tastatur – dann wandert der Fokus zur Überschrift
            onClick={(e) => onSelect(entry, e.detail === 0)}
            onFocus={() => onFocusEntry(index)}
            className={cn(
              'w-full rounded-md px-2 py-1 text-left text-sm',
              index === current ? 'bg-active font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg',
            )}
          >
            <span className="line-clamp-2 break-words">{entry.text}</span>
          </button>
          {children.length > 0 ? (
            <Entries
              nodes={children}
              current={current}
              tabStop={tabStop}
              nested
              onSelect={onSelect}
              onFocusEntry={onFocusEntry}
            />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export function NoteOutline({
  id,
  entries,
  truncated,
  current,
  overlay,
  format,
  autoFocus,
  onSelect,
  onClose,
}: {
  id: string
  entries: OutlineEntry[]
  truncated: boolean
  /** Index des Abschnitts an der Leseposition, -1 ohne Einträge */
  current: number
  /** Über dem Blatt statt daneben */
  overlay: boolean
  format: NoteFormat
  /** Per Tastatur geöffnet: Fokus auf den aktuellen Eintrag, sobald er feststeht */
  autoFocus: boolean
  onSelect: (entry: OutlineEntry, byKeyboard: boolean) => void
  onClose: () => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const tree = useMemo(() => outlineTree(entries), [entries])
  // Ein einziger Tab-Stopp für die ganze Liste: der fokussierte Eintrag, sonst der aktuelle
  const [focused, setFocused] = useState<number | null>(null)
  const tabStop = focused !== null && focused < entries.length ? focused : Math.max(current, 0)

  const wantsFocus = useRef(autoFocus)
  useEffect(() => {
    if (!wantsFocus.current || (current < 0 && entries.length > 0)) return
    wantsFocus.current = false
    ;(listRef.current?.querySelector<HTMLElement>('[tabindex="0"]') ?? closeRef.current)?.focus()
  }, [current, entries.length])

  // Den aktuellen Eintrag in der Liste sichtbar halten
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current])

  // Escape schließt das Overlay – auch wenn der Fokus noch auf dem Knopf im Kopf steht
  useEffect(() => {
    if (!overlay) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [overlay, onClose])

  function onKeyDown(e: React.KeyboardEvent) {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-index]') ?? [])]
    const i = buttons.indexOf(e.target as HTMLButtonElement)
    if (i < 0) return
    const moves: Record<string, number> = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: buttons.length - 1 }
    const next = moves[e.key]
    if (next === undefined) return
    e.preventDefault()
    buttons[Math.min(Math.max(next, 0), buttons.length - 1)].focus()
  }

  return (
    <nav
      id={id}
      aria-label="Gliederung"
      data-testid="note-outline"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(null)
      }}
      className={cn(
        'flex flex-col print:hidden',
        overlay
          ? 'absolute inset-y-0 left-0 z-10 w-[min(18rem,85%)] animate-slide-in-left border-r border-border bg-elevated shadow-lg'
          : 'w-60 shrink-0 bg-(--bg-desk)',
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 pr-1 pl-3">
        <h2 className="flex-1 text-sm font-medium">Gliederung</h2>
        <Button ref={closeRef} size="icon-sm" variant="ghost" onClick={onClose} aria-label="Gliederung schließen">
          <X className="size-4" />
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted">
          {format === 'richtext'
            ? 'Noch keine Überschriften. Überschriften aus dem Absatzformat erscheinen hier.'
            : 'Noch keine Überschriften. Zeilen, die mit # beginnen, erscheinen hier.'}
        </p>
      ) : (
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4" onKeyDown={onKeyDown}>
          <Entries nodes={tree} current={current} tabStop={tabStop} onSelect={onSelect} onFocusEntry={setFocused} />
          {truncated ? <p className="px-2 pt-2 text-xs text-faint">Weitere Überschriften ausgelassen</p> : null}
        </div>
      )}
    </nav>
  )
}
