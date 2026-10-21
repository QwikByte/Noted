'use client'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, FileText, Plus, Search } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { cn } from '@/shared/ui/cn'
import { useBackdropPress } from '@/shared/ui/modal'
import { useFolders, useNotes } from '../client/queries'
import { folderPath, fuzzyScore } from '../tree'
import { validateName } from '@/shared/lib/names'

type Item =
  | { kind: 'note'; id: string; title: string; path: string }
  | { kind: 'create'; title: string }
  | { kind: 'search'; query: string }

/** Schnellwechsler (Strg/⌘+K): Notiz per Titel öffnen oder neu anlegen. */
export function QuickSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp()
  const { notes } = useNotes()
  const { data: folders = [] } = useFolders()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const listId = useId()
  const backdropPress = useBackdropPress(dialogRef)

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) {
      setQuery('')
      setActive(0)
      d.showModal()
    } else if (!open && d.open) d.close()
  }, [open])

  const items: Item[] = useMemo(() => {
    const q = query.trim()
    const scored = notes
      .map((n) => {
        const path = folderPath(folders, n.folderId)
          .map((f) => f.name)
          .join(' / ')
        const score = q ? Math.max(fuzzyScore(q, n.title), fuzzyScore(q, `${path} ${n.title}`) - 50) : n.updatedAt
        return { n, path, score }
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((x): Item => ({ kind: 'note', id: x.n.id, title: x.n.title, path: x.path }))
    if (q) {
      const exact = notes.some((n) => n.title.toLowerCase() === q.toLowerCase())
      if (!exact && !validateName(q)) scored.push({ kind: 'create', title: q })
      scored.push({ kind: 'search', query: q })
    }
    return scored
  }, [query, notes, folders])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function choose(item: Item) {
    onClose()
    if (item.kind === 'note') app.go({ kind: 'note', id: item.id })
    else if (item.kind === 'create') void app.createNote({ title: item.title, folderId: null })
    else app.go({ kind: 'search', q: item.query })
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      {...backdropPress(onClose)}
      className="mx-auto mt-[10vh] w-[calc(100%-1.5rem)] max-w-xl overflow-hidden rounded-2xl border border-border bg-elevated p-0 text-fg shadow-pop backdrop:bg-black/40 open:animate-pop-in open:backdrop:animate-fade-in"
      aria-label="Schnellwechsler"
    >
      {open ? (
        <div>
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-5 text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActive((a) => Math.min(a + 1, items.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((a) => Math.max(a - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  const item = items[active]
                  if (item) choose(item)
                }
              }}
              placeholder="Notiz suchen oder neu anlegen …"
              className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
              aria-label="Suchbegriff"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={items.length > 0}
              aria-controls={listId}
              aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
            />
            <kbd className="hidden rounded border border-border px-1.5 text-[11px] text-faint sm:block">Esc</kbd>
          </div>
          <ul ref={listRef} id={listId} className="max-h-[50vh] overflow-y-auto overscroll-contain p-1.5" role="listbox" aria-label="Notizen">
            {items.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted">Keine Notizen gefunden.</li> : null}
            {items.map((item, i) => (
              <li key={item.kind === 'note' ? item.id : `${item.kind}-${i}`} data-index={i} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                {/* Ausgewählt wird mit den Pfeiltasten im Suchfeld – die Einträge selbst sind kein eigener Tab-Halt */}
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(item)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                    i === active ? 'bg-accent-soft text-fg' : 'text-fg',
                  )}
                >
                  {item.kind === 'note' ? (
                    <>
                      <FileText className="size-4 shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {item.path ? <span className="max-w-[40%] truncate text-xs text-faint">{item.path}</span> : null}
                    </>
                  ) : item.kind === 'create' ? (
                    <>
                      <Plus className="size-4 shrink-0 text-accent-text" />
                      <span className="flex-1 truncate">
                        Neue Notiz „<strong>{item.title}</strong>“ anlegen
                      </span>
                    </>
                  ) : (
                    <>
                      <Search className="size-4 shrink-0 text-faint" />
                      <span className="flex-1 truncate">Volltextsuche nach „{item.query}“</span>
                    </>
                  )}
                  {i === active ? <CornerDownLeft className="size-3.5 shrink-0 text-faint" /> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </dialog>
  )
}
