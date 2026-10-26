'use client'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookA,
  BookOpen,
  ChevronRight,
  CloudOff,
  FileText,
  File,
  Files,
  Folder as FolderIcon,
  FolderPlus,
  GraduationCap,
  Hash,
  Loader2,
  Lock,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { Button } from '@/shared/ui/button'
import { Menu, MenuItem, MenuSeparator, useContextMenu } from '@/shared/ui/menu'
import { Page, PageHeader } from '@/shared/ui/page-layout'
import { cn } from '@/shared/ui/cn'
import { api, NetworkError } from '@/shared/client/api'
import { keys, useFolders, useNotes } from '../client/queries'
import { startDrag, useDraggedIds, useDropTarget } from '../client/drag'
import { NoteSelectionContext, useNoteSelection, useNoteSelectionContext } from '../client/selection'
import { descendantFolderIds, folderPath, sortByName, sortNotes } from '../tree'
import { formatRelative } from '@/shared/lib/format'
import { parseSearch, positiveQuery } from '@/shared/lib/search-query'
import type { FileSearchResult } from '@/features/attachments/types'
import type { Folder, NoteSummary, SearchResponse, SearchResult } from '../types'
import { FolderMenuItems, NoteMenuItems } from './ItemMenus'
import { NoteSelectionBar, NoteSelectionMenuItems, SelectButton, SelectionCheckbox } from './SelectionBar'
import { SortMenu, useNoteOrder } from './SortMenu'
import { FolderOptions } from './dialogs'
import { Select } from '@/shared/ui/input'
import { NavLink } from '@/features/workspace/components/NavLink'
import { useVaultInfo, useVaultState } from '@/features/vault/client/vault'
import { requestVault } from '@/features/vault/client/vault-ui'

/** Notizen in Anzeigereihenfolge der Liste – Umschalt-Klick wählt nur innerhalb einer Liste einen Bereich */
const ListOrderContext = createContext<readonly string[]>([])

/** Notizen als Liste – wie ein Inhaltsverzeichnis: Titel, Auszug, Ablageort */
function NoteList({ order = [], children }: { order?: readonly string[]; children: React.ReactNode }) {
  return (
    <ListOrderContext.Provider value={order}>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-elevated">{children}</div>
    </ListOrderContext.Provider>
  )
}

function NoteCard({
  note,
  folders,
  snippet,
  find,
}: {
  note: NoteSummary | SearchResult
  folders: Folder[]
  snippet?: string
  /** Suchwörter: Die Notiz öffnet an der ersten Fundstelle */
  find?: string
}) {
  const { notes } = useNotes()
  const openContextMenu = useContextMenu()
  const selection = useNoteSelectionContext()
  const listOrder = useContext(ListOrderContext)
  const dragged = useDraggedIds().includes(note.id)
  // Suchtreffer haben nicht alle Felder – für die Aktionen die Notiz aus der Liste
  const summary = notes.find((n) => n.id === note.id)
  const path = folderPath(folders, note.folderId)
  const tags = 'tags' in note ? note.tags : []
  const selecting = !!selection?.active
  const selected = !!selection?.ids.has(note.id)
  const toggle = (e: React.MouseEvent) => selection?.click(note.id, listOrder, e)

  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    // Eine ausgewählte Notiz zieht alle ausgewählten mit, eine andere wird allein gezogen
    const ids = selection && selected ? selection.order.filter((id) => selection.ids.has(id)) : [note.id]
    startDrag(e, {
      kind: 'notes',
      ids,
      title: ids.length === 1 ? note.title : `${ids.length} Notizen`,
      onMoved: selected ? selection?.stop : undefined,
    })
  }

  return (
    <div
      className={cn(
        'group flex transition-colors select-none [-webkit-touch-callout:none]',
        selected ? 'bg-accent-soft' : 'hover:bg-subtle',
        dragged && 'opacity-50',
      )}
      onContextMenu={(e) =>
        openContextMenu(
          e,
          selection && selected && selection.ids.size >= 2 ? (
            <NoteSelectionMenuItems selection={selection} />
          ) : summary ? (
            <NoteMenuItems note={summary} context />
          ) : null,
        )
      }
    >
      {selecting ? <SelectionCheckbox title={note.title} checked={selected} onToggle={toggle} className="pt-3.5 pl-4" /> : null}
      <NavLink
        // Suchwörter nicht für Tresor-Notizen in die Adresse (Browserverlauf)
        to={{ kind: 'note', id: note.id, find: summary?.vault ? undefined : find }}
        // Im Auswahlmodus sind die Checkboxen die Tab-Stopps
        tabIndex={selecting ? -1 : undefined}
        onClick={(e) => {
          // Strg/⌘- und Umschalt-Klick wählen aus statt einen neuen Tab zu öffnen – der bleibt über Mittelklick
          if (!selection || !(selecting || e.ctrlKey || e.metaKey || e.shiftKey)) return
          e.preventDefault()
          toggle(e)
        }}
        // In einen Ordner der Seitenleiste oder der Ordneransicht ziehen
        onPointerDown={onPointerDown}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 text-left focus-visible:-outline-offset-2"
      >
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold group-hover:text-accent-text">{note.title}</span>
          {'pinned' in note && note.pinned ? <Pin className="size-3.5 shrink-0 self-center text-faint" aria-label="Angeheftet" /> : null}
          <span className="shrink-0 text-xs text-faint tabular-nums">{formatRelative(note.updatedAt)}</span>
        </div>
        {snippet !== undefined ? (
          <p className="search-snippet line-clamp-2 text-sm text-muted" dangerouslySetInnerHTML={{ __html: snippet }} />
        ) : 'excerpt' in note && note.excerpt ? (
          <p className="line-clamp-1 text-sm text-muted">{note.excerpt}</p>
        ) : 'vault' in note && note.vault ? (
          <p className="flex items-center gap-1 text-sm text-faint">
            <Lock className="size-3.5" /> Im Tresor
          </p>
        ) : (
          <p className="text-sm text-faint">Noch leer</p>
        )}
        {path.length > 0 || tags.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
            {path.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <FolderIcon className="size-3" />
                {path.map((f) => f.name).join(' / ')}
              </span>
            ) : null}
            {tags.slice(0, 4).map((t) => (
              <span key={t} className="text-accent-text">
                #{t}
              </span>
            ))}
          </div>
        ) : null}
      </NavLink>
    </div>
  )
}

function EmptyState({ icon, title, text, action }: { icon: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
      <div className="mb-3 text-faint [&>svg]:size-9 [&>svg]:stroke-[1.5]">{icon}</div>
      <p className="font-semibold">{title}</p>
      {text ? <p className="mt-1 max-w-sm text-sm text-muted">{text}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

/** Notizen auf der Startseite: neue Notiz aus Vorlage, angeheftete und zuletzt bearbeitete */
export function HomeNotes() {
  const app = useApp()
  const { notes, isLoading, error } = useNotes()
  const { data: folders = [] } = useFolders()
  const pinned = notes.filter((n) => n.pinned)
  const recent = [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12)
  const pinnedOrder = pinned.map((n) => n.id)
  const recentOrder = recent.map((n) => n.id)
  // Beide Abschnitte bilden eine Auswahl – eine Notiz in beiden ist über ihre ID in beiden markiert
  const order = [...new Set([...pinnedOrder, ...recentOrder])]
  const root = useRef<HTMLDivElement>(null)
  const selection = useNoteSelection({ order, resetKey: 'home', root })

  const quick = [
    { id: 'lecture', label: 'Vorlesung', icon: <GraduationCap className="size-4.5" /> },
    { id: 'exercise', label: 'Übung', icon: <NotebookPen className="size-4.5" /> },
    { id: 'cheatsheet', label: 'Lernzettel', icon: <BookOpen className="size-4.5" /> },
    { id: 'empty', label: 'Leere Notiz', icon: <Plus className="size-4.5" /> },
  ]

  const heading = (text: string, first: boolean) => (
    <div className="mb-2.5 flex min-h-8 items-center gap-2">
      <h2 className="flex-1 text-sm font-semibold text-muted">{text}</h2>
      {first ? <SelectButton selection={selection} /> : null}
    </div>
  )

  return (
    <div ref={root}>
      <div className="mb-10 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" aria-label="Neue Notiz aus Vorlage" role="group">
        {quick.map((q) => (
          <button
            key={q.id}
            type="button"
            onClick={() => app.openNewNote({ templateId: q.id })}
            className="flex h-11 items-center gap-2.5 rounded-lg border border-border bg-elevated px-3.5 text-left text-sm font-medium transition-colors hover:border-accent hover:text-accent-text [&>svg]:text-faint hover:[&>svg]:text-accent-text"
          >
            {q.icon}
            {q.label}
          </button>
        ))}
      </div>

      {error instanceof NetworkError ? (
        <div className="mb-6 flex items-center gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
          <CloudOff className="size-4" /> Du bist offline. Zuletzt geladene Notizen sind weiterhin verfügbar.
        </div>
      ) : null}

      <NoteSelectionContext.Provider value={selection}>
        <NoteSelectionBar selection={selection} />
        {pinned.length > 0 ? (
          <section className="mb-8">
            {heading('Angeheftet', true)}
            <NoteList order={pinnedOrder}>
              {pinned.map((n) => (
                <NoteCard key={n.id} note={n} folders={folders} />
              ))}
            </NoteList>
          </section>
        ) : null}

        <section>
          {heading('Zuletzt bearbeitet', pinned.length === 0)}
          {isLoading && notes.length === 0 ? (
            <div className="flex justify-center py-10 text-faint">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<NotebookPen />}
              title="Noch keine Notizen"
              action={
                <Button variant="primary" onClick={() => app.openNewNote({ templateId: 'lecture' })}>
                  <Plus className="size-4" /> Erste Notiz
                </Button>
              }
            />
          ) : (
            <NoteList order={recentOrder}>
              {recent.map((n) => (
                <NoteCard key={n.id} note={n} folders={folders} />
              ))}
            </NoteList>
          )}
        </section>
      </NoteSelectionContext.Provider>
    </div>
  )
}

export function FolderView({ id }: { id: string }) {
  const app = useApp()
  const qc = useQueryClient()
  const openContextMenu = useContextMenu()
  const { notes } = useNotes()
  const { data: folders = [], isLoading } = useFolders()
  const { unlocked } = useVaultState()
  const dropTarget = useDropTarget()
  const dragged = useDraggedIds()
  const folder = folders.find((f) => f.id === id)
  const path = folderPath(folders, id)
  const [sortOrder, setSortOrder] = useNoteOrder('folder')
  // Unterordner bleiben alphabetisch, nur die Notizen folgen der gewählten Reihenfolge
  const children = sortByName(folders.filter((f) => f.parentId === id))
  const items = sortNotes(
    notes.filter((n) => n.folderId === id),
    sortOrder,
  )
  const order = items.map((n) => n.id)
  const root = useRef<HTMLDivElement>(null)
  // Nur die Notizen sind auswählbar, nicht die Karten der Unterordner
  const selection = useNoteSelection({ order, resetKey: `folder:${id}`, root })

  // Gesperrt sind nur der Wurzelordner des Tresors und dessen Name zu sehen (Unterordner fehlen in der Liste)
  const lockedVault =
    !unlocked && (folder?.vault || qc.getQueryData<Folder[]>(keys.folders)?.find((f) => f.id === id)?.vault)
  if (lockedVault) {
    return (
      <Page>
        <EmptyState
          icon={<Lock />}
          title="Tresor – gesperrt"
          text="Die Notizen im Tresor sind verschlüsselt. Entsperre ihn mit deinem Tresor-Passwort."
          action={
            <Button variant="primary" onClick={() => requestVault({ kind: 'unlock' })}>
              Entsperren
            </Button>
          }
        />
      </Page>
    )
  }

  if (!folder) {
    return (
      <Page>
        {isLoading ? (
          <Loader2 className="mx-auto size-6 animate-spin text-faint" />
        ) : (
          <EmptyState icon={<FolderIcon />} title="Ordner nicht gefunden" action={<Button onClick={() => app.go({ kind: 'home' })}>Zur Startseite</Button>} />
        )}
      </Page>
    )
  }

  const vaultRoot = folder.vault && folder.nameEnc === null
  // Die ganze Seite nimmt Notizen und Ordner auf (z. B. aus der Seitenleiste), Unterordner und Pfad ebenso
  return (
    <Page>
      <div
        ref={root}
        data-drop-folder={id}
        className={cn('-m-2 rounded-xl p-2', dropTarget === id && 'ring-2 ring-accent ring-inset')}
      >
        <PageHeader
          title={folder.name}
          subtitle={`${items.length} ${items.length === 1 ? 'Notiz' : 'Notizen'}${children.length ? ` · ${children.length} ${children.length === 1 ? 'Unterordner' : 'Unterordner'}` : ''}`}
          breadcrumb={
            path.length > 1 ? (
              <div className="mb-2 flex flex-wrap items-center gap-1 text-sm text-muted">
                {path.slice(0, -1).map((f) => (
                  <span key={f.id} className="flex items-center gap-1">
                    <NavLink
                      to={{ kind: 'folder', id: f.id }}
                      data-drop-folder={f.id}
                      className={cn(
                        'rounded px-1 -mx-1 hover:text-fg',
                        dropTarget === f.id && 'bg-accent-soft text-accent-text ring-2 ring-accent',
                      )}
                    >
                      {f.name}
                    </NavLink>
                    <ChevronRight className="size-3.5" />
                  </span>
                ))}
              </div>
            ) : null
          }
          actions={
            <>
              {items.length > 1 ? <SortMenu order={sortOrder} onChange={setSortOrder} /> : null}
              <SelectButton selection={selection} />
              <Button variant="primary" size="sm" onClick={() => app.openNewNote({ folderId: id })} className="max-sm:hidden">
                <Plus className="size-4" /> Notiz
              </Button>
              <Menu
                trigger={(p) => (
                  <Button size="icon-sm" aria-label="Ordner-Aktionen" {...p}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                )}
              >
                <MenuItem icon={<FolderPlus />} onSelect={() => app.openNewFolder(id)}>
                  Neuer Unterordner
                </MenuItem>
                {/* Im Tresor: kein Glossar und keine Dateien; den Wurzelordner nicht umbenennen oder löschen */}
                {vaultRoot ? null : (
                  <MenuItem icon={<Pencil />} onSelect={() => app.openRenameFolder(folder)}>
                    Umbenennen
                  </MenuItem>
                )}
                {folder.vault ? null : (
                  <>
                    <MenuItem icon={<BookA />} onSelect={() => app.go({ kind: 'glossary', folder: id })}>
                      Glossar und Formeln
                    </MenuItem>
                    <MenuItem icon={<Files />} onSelect={() => app.go({ kind: 'files', folder: id })}>
                      Dateien
                    </MenuItem>
                  </>
                )}
                {vaultRoot ? null : (
                  <>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 />} danger onSelect={() => app.deleteFolder(folder)}>
                      Löschen
                    </MenuItem>
                  </>
                )}
              </Menu>
            </>
          }
        />
        {children.length > 0 ? (
          <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {children.map((f) => (
              <NavLink
                key={f.id}
                to={{ kind: 'folder', id: f.id }}
                data-drop-folder={f.id}
                onContextMenu={(e) => openContextMenu(e, <FolderMenuItems folder={f} context />)}
                onPointerDown={(e) => startDrag(e, { kind: 'folder', id: f.id, name: f.name })}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border border-border bg-elevated px-4 py-3 text-left text-sm font-medium transition-colors select-none [-webkit-touch-callout:none] hover:border-border-strong hover:bg-subtle',
                  dropTarget === f.id && 'border-accent bg-accent-soft ring-2 ring-accent',
                  dragged.includes(f.id) && 'opacity-50',
                )}
              >
                <FolderIcon className="size-4 text-muted" />
                <span className="truncate">{f.name}</span>
                <span className="ml-auto text-xs text-faint">{notes.filter((n) => n.folderId === f.id).length}</span>
              </NavLink>
            ))}
          </div>
        ) : null}
        {items.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="Dieser Ordner ist leer"
            action={
              <Button variant="primary" onClick={() => app.openNewNote({ folderId: id })}>
                <Plus className="size-4" /> Neue Notiz
              </Button>
            }
          />
        ) : (
          <NoteSelectionContext.Provider value={selection}>
            <NoteSelectionBar selection={selection} />
            <NoteList order={order}>
              {items.map((n) => (
                <NoteCard key={n.id} note={n} folders={folders} />
              ))}
            </NoteList>
          </NoteSelectionContext.Provider>
        )}
      </div>
    </Page>
  )
}

export function TagView({ tag }: { tag: string }) {
  const app = useApp()
  const { notes } = useNotes()
  const { data: folders = [] } = useFolders()
  const [sortOrder, setSortOrder] = useNoteOrder('tag')
  const items = sortNotes(
    notes.filter((n) => n.tags.some((t) => t === tag || t.startsWith(tag + '/'))),
    sortOrder,
  )
  const order = items.map((n) => n.id)
  const root = useRef<HTMLDivElement>(null)
  const selection = useNoteSelection({ order, resetKey: `tag:${tag}`, root })
  return (
    <Page>
      <div ref={root}>
        <PageHeader
          title={`#${tag}`}
          subtitle={`${items.length} ${items.length === 1 ? 'Notiz' : 'Notizen'}`}
          actions={
            <>
              {items.length > 1 ? <SortMenu order={sortOrder} onChange={setSortOrder} /> : null}
              <SelectButton selection={selection} />
              {items.length > 0 ? (
                <Menu
                  trigger={(p) => (
                    <Button size="icon-sm" aria-label="Tag-Aktionen" {...p}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  )}
                >
                  <MenuItem icon={<Pencil />} onSelect={() => app.openRenameTag(tag)}>
                    Umbenennen …
                  </MenuItem>
                </Menu>
              ) : null}
            </>
          }
        />
        {items.length === 0 ? (
          <EmptyState icon={<Hash />} title="Keine Notizen mit diesem Tag" />
        ) : (
          <NoteSelectionContext.Provider value={selection}>
            <NoteSelectionBar selection={selection} />
            <NoteList order={order}>
              {items.map((n) => (
                <NoteCard key={n.id} note={n} folders={folders} />
              ))}
            </NoteList>
          </NoteSelectionContext.Provider>
        )}
      </div>
    </Page>
  )
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function snippetHtml(snippet: string) {
  return escapeHtml(snippet).replace(/\u0002/g, '<mark>').replace(/\u0003/g, '</mark>')
}

/**
 * Treffer in einer Datei: PDFs öffnen im eingebauten Viewer auf der Seite, mit den Suchwörtern `terms` hervorgehoben;
 * andere Dateien werden heruntergeladen
 */
function FileHit({ hit, terms }: { hit: FileSearchResult; terms: string[] }) {
  const app = useApp()
  const pdf = hit.mime === 'application/pdf'
  const className =
    'group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle focus-visible:-outline-offset-2'
  const body = (
    <>
      {pdf ? <FileText className="mt-1 size-4 shrink-0 text-faint" /> : <File className="mt-1 size-4 shrink-0 text-faint" />}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold group-hover:text-accent-text">{hit.filename}</span>
          {pdf ? <span className="shrink-0 text-xs text-faint tabular-nums">Seite {hit.page}</span> : null}
        </span>
        <span
          className="search-snippet line-clamp-2 text-sm text-muted"
          dangerouslySetInnerHTML={{ __html: snippetHtml(hit.snippet) }}
        />
      </span>
    </>
  )
  return pdf ? (
    <button type="button" onClick={() => app.openPdf(hit.filename, hit.page, { find: terms })} className={className}>
      {body}
    </button>
  ) : (
    <a href={`/api/attachments/${hit.id}?download=1`} className={className}>
      {body}
    </a>
  )
}

export function SearchView({ initialQuery, folder }: { initialQuery: string; folder?: string }) {
  const app = useApp()
  const [query, setQuery] = useState(initialQuery)
  const [debounced, setDebounced] = useState(initialQuery)
  const { notes } = useNotes()
  const { data: folders = [] } = useFolders()
  const { data: vaultInfo } = useVaultInfo()
  // Im Tresor wird nicht gesucht – seine Ordner stehen nicht zur Wahl
  const vaultFolders = useMemo(() => new Set(folders.filter((f) => f.vault).map((f) => f.id)), [folders])

  const [prevInitial, setPrevInitial] = useState(initialQuery)
  if (prevInitial !== initialQuery) {
    setPrevInitial(initialQuery)
    setQuery(initialQuery)
  }
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query.trim())
      if (query !== initialQuery) app.go({ kind: 'search', q: query, folder }, { replace: true })
    }, 250)
    return () => clearTimeout(t)
  }, [query, initialQuery, folder, app])

  const parsed = useMemo(() => parseSearch(debounced), [debounced])
  // Nur Ausschlüsse („-klausur“): FTS5 braucht mindestens ein Wort, sonst wären es alle Notizen außer …
  const onlyExcluded =
    parsed.terms.length + parsed.phrases.length + parsed.tags.length === 0 &&
    parsed.excluded.length + parsed.excludedTags.length > 0
  const search = useQuery({
    queryKey: keys.search(debounced, folder),
    queryFn: () =>
      api<SearchResponse>(
        `/api/search?q=${encodeURIComponent(debounced)}${folder ? `&folder=${encodeURIComponent(folder)}` : ''}`,
      ),
    enabled: debounced.length > 0 && !onlyExcluded,
    staleTime: 5_000,
  })
  const results = search.data?.results ?? []
  const files = search.data?.files ?? []
  // Dieselben Wörter und Phrasen wie auf dem Server (ohne Ausschlüsse und #tags) – der PDF-Viewer hebt sie hervor,
  // Notizen öffnen an der Fundstelle
  const fileTerms = useMemo(() => [...parsed.terms, ...parsed.phrases], [parsed])
  const find = positiveQuery(debounced) || undefined

  // Offline: zumindest Titel und Auszüge lokal durchsuchen – wie online ohne den Tresor
  const offlineResults = useMemo(() => {
    if (!(search.error instanceof NetworkError) || !debounced) return null
    const inFolder = folder ? descendantFolderIds(folders, folder) : null
    const hasTag = (n: NoteSummary, tag: string) => n.tags.some((t) => t === tag || t.startsWith(tag + '/'))
    return notes.filter((n) => {
      if (n.vault || (inFolder && !(n.folderId && inFolder.has(n.folderId)))) return false
      const text = `${n.title}\n${n.excerpt}`.toLowerCase()
      return (
        fileTerms.every((t) => text.includes(t.toLowerCase())) &&
        !parsed.excluded.some((t) => text.includes(t.toLowerCase())) &&
        parsed.tags.every((t) => hasTag(n, t)) &&
        !parsed.excludedTags.some((t) => hasTag(n, t))
      )
    })
  }, [search.error, debounced, notes, folder, folders, fileTerms, parsed])

  // Auswählbar sind die Notiz-Treffer (auch offline), nicht die Treffer in Dateien
  const order = (offlineResults ?? (debounced ? results : [])).map((n) => n.id)
  const root = useRef<HTMLDivElement>(null)
  const selection = useNoteSelection({ order, resetKey: `search:${debounced}`, root })

  return (
    <Page>
      <div ref={root}>
        <div className="mb-6 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-faint" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Notizen durchsuchen …"
              className="h-13 w-full rounded-xl border border-border-strong/70 bg-elevated pr-4 pl-12 text-base outline-none focus:border-accent focus:ring-3 focus:ring-accent/20"
              aria-label="Suchbegriff"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted sm:w-56">
            In
            <Select
              value={folder ?? ''}
              onChange={(e) => app.go({ kind: 'search', q: query, folder: e.target.value || undefined }, { replace: true })}
              aria-label="Suchen in"
              className="h-13 flex-1 rounded-xl"
            >
              <option value="">Alle Ordner</option>
              <FolderOptions exclude={vaultFolders} />
            </Select>
          </label>
        </div>
        {!debounced ? (
          <EmptyState
            icon={<Search />}
            title="Volltextsuche"
            text={`Durchsucht Notizen sowie PDFs und Textdateien. „Satz von Bayes“ in Anführungszeichen sucht genau diese Wortfolge, -wort schließt ein Wort aus, #tag filtert nach Tags (-#tag schließt aus), und „In“ beschränkt die Suche auf einen Ordner samt Unterordnern.${vaultInfo ? ' Notizen im Tresor werden nicht durchsucht.' : ''}`}
          />
        ) : onlyExcluded ? (
          <EmptyState
            icon={<Search />}
            title="Gib mindestens ein Suchwort ein"
            text="Mit -wort schließt du Wörter nur aus. Ergänze ein Wort, eine „Phrase“ oder einen #tag, nach dem gesucht wird."
          />
        ) : offlineResults ? (
          <NoteSelectionContext.Provider value={selection}>
            <div className="mb-3 flex items-center gap-2">
              <p className="flex flex-1 items-center gap-2 text-sm text-warning">
                <CloudOff className="size-4 shrink-0" /> Offline – es werden nur Titel und Auszüge durchsucht.
              </p>
              <SelectButton selection={selection} />
            </div>
            <NoteSelectionBar selection={selection} />
            <NoteList order={order}>
              {offlineResults.map((n) => (
                <NoteCard key={n.id} note={n} folders={folders} find={find} />
              ))}
            </NoteList>
          </NoteSelectionContext.Provider>
        ) : search.isLoading ? (
          <div className="flex justify-center py-10 text-faint">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : results.length === 0 && files.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="Nichts gefunden"
            text={folder ? 'Gesucht wurde nur in diesem Ordner und seinen Unterordnern – Dateien nicht.' : undefined}
          />
        ) : (
          <>
            {results.length > 0 ? (
              <NoteSelectionContext.Provider value={selection}>
                <div className="mb-3 flex items-center gap-2">
                  <p className="flex-1 text-sm text-muted">
                    {results.length} {results.length === 1 ? 'Treffer' : 'Treffer'}
                  </p>
                  <SelectButton selection={selection} />
                </div>
                <NoteSelectionBar selection={selection} />
                <NoteList order={order}>
                  {results.map((r) => (
                    <NoteCard key={r.id} note={r} folders={folders} snippet={snippetHtml(r.snippet)} find={find} />
                  ))}
                </NoteList>
              </NoteSelectionContext.Provider>
            ) : null}
            {folder ? (
              <p className="mt-6 text-sm text-faint" data-testid="search-files-hidden">
                Dateien gehören keinem Ordner fest an und werden mit Ordnerfilter nicht durchsucht.
              </p>
            ) : null}
            {files.length > 0 ? (
              <section className={cn(results.length > 0 && 'mt-8')} aria-labelledby="search-files" data-testid="search-files">
                <h2 id="search-files" className="mb-3 text-sm text-muted">
                  In Dateien
                </h2>
                <NoteList>
                  {files.map((f) => (
                    <FileHit key={`${f.id}:${f.page}`} hit={f} terms={fileTerms} />
                  ))}
                </NoteList>
              </section>
            ) : null}
          </>
        )}
      </div>
    </Page>
  )
}
