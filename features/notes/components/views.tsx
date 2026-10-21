'use client'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { startDrag, useDraggedId, useDropTarget } from '../client/drag'
import { folderPath, sortByName } from '../tree'
import { formatRelative } from '@/shared/lib/format'
import type { FileSearchResult } from '@/features/attachments/types'
import type { Folder, NoteSummary, SearchResponse, SearchResult } from '../types'
import { FolderMenuItems, NoteMenuItems } from './ItemMenus'
import { NavLink } from '@/features/workspace/components/NavLink'

/** Notizen als Liste – wie ein Inhaltsverzeichnis: Titel, Auszug, Ablageort */
function NoteList({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-elevated">{children}</div>
}

function NoteCard({ note, folders, snippet }: { note: NoteSummary | SearchResult; folders: Folder[]; snippet?: string }) {
  const { notes } = useNotes()
  const openContextMenu = useContextMenu()
  const dragged = useDraggedId() === note.id
  // Suchtreffer haben nicht alle Felder – für die Aktionen die Notiz aus der Liste
  const summary = notes.find((n) => n.id === note.id)
  const path = folderPath(folders, note.folderId)
  const tags = 'tags' in note ? note.tags : []
  return (
    <NavLink
      to={{ kind: 'note', id: note.id }}
      onContextMenu={(e) => openContextMenu(e, summary ? <NoteMenuItems note={summary} context /> : null)}
      // In einen Ordner der Seitenleiste oder der Ordneransicht ziehen
      onPointerDown={(e) => startDrag(e, { kind: 'note', id: note.id, title: note.title })}
      className={cn(
        'group flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors select-none [-webkit-touch-callout:none] hover:bg-subtle focus-visible:-outline-offset-2',
        dragged && 'opacity-50',
      )}
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

  const quick = [
    { id: 'lecture', label: 'Vorlesung', icon: <GraduationCap className="size-4.5" /> },
    { id: 'exercise', label: 'Übung', icon: <NotebookPen className="size-4.5" /> },
    { id: 'cheatsheet', label: 'Lernzettel', icon: <BookOpen className="size-4.5" /> },
    { id: 'empty', label: 'Leere Notiz', icon: <Plus className="size-4.5" /> },
  ]

  return (
    <>
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

      {pinned.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-2.5 text-sm font-semibold text-muted">Angeheftet</h2>
          <NoteList>
            {pinned.map((n) => (
              <NoteCard key={n.id} note={n} folders={folders} />
            ))}
          </NoteList>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2.5 text-sm font-semibold text-muted">Zuletzt bearbeitet</h2>
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
          <NoteList>
            {recent.map((n) => (
              <NoteCard key={n.id} note={n} folders={folders} />
            ))}
          </NoteList>
        )}
      </section>
    </>
  )
}

export function FolderView({ id }: { id: string }) {
  const app = useApp()
  const openContextMenu = useContextMenu()
  const { notes } = useNotes()
  const { data: folders = [], isLoading } = useFolders()
  const dropTarget = useDropTarget()
  const dragged = useDraggedId()
  const folder = folders.find((f) => f.id === id)
  const path = folderPath(folders, id)
  const children = sortByName(folders.filter((f) => f.parentId === id))
  const items = sortByName(notes.filter((n) => n.folderId === id))

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

  // Die ganze Seite nimmt Notizen und Ordner auf (z. B. aus der Seitenleiste), Unterordner und Pfad ebenso
  return (
    <Page>
      <div
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
                <MenuItem icon={<Pencil />} onSelect={() => app.openRenameFolder(folder)}>
                  Umbenennen
                </MenuItem>
                <MenuItem icon={<BookA />} onSelect={() => app.go({ kind: 'glossary', folder: id })}>
                  Glossar und Formeln
                </MenuItem>
                <MenuItem icon={<Files />} onSelect={() => app.go({ kind: 'files', folder: id })}>
                  Dateien
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Trash2 />} danger onSelect={() => app.deleteFolder(folder)}>
                  Löschen
                </MenuItem>
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
                  dragged === f.id && 'opacity-50',
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
          <NoteList>
            {items.map((n) => (
              <NoteCard key={n.id} note={n} folders={folders} />
            ))}
          </NoteList>
        )}
      </div>
    </Page>
  )
}

export function TagView({ tag }: { tag: string }) {
  const { notes } = useNotes()
  const { data: folders = [] } = useFolders()
  const items = notes
    .filter((n) => n.tags.some((t) => t === tag || t.startsWith(tag + '/')))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <Page>
      <PageHeader title={`#${tag}`} subtitle={`${items.length} ${items.length === 1 ? 'Notiz' : 'Notizen'}`} />
      {items.length === 0 ? (
        <EmptyState icon={<Hash />} title="Keine Notizen mit diesem Tag" />
      ) : (
        <NoteList>
          {items.map((n) => (
            <NoteCard key={n.id} note={n} folders={folders} />
          ))}
        </NoteList>
      )}
    </Page>
  )
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function snippetHtml(snippet: string) {
  return escapeHtml(snippet).replace(/\u0002/g, '<mark>').replace(/\u0003/g, '</mark>')
}

/** Treffer in einer Datei: PDFs öffnen im eingebauten Viewer auf der Seite, andere Dateien werden heruntergeladen */
function FileHit({ hit }: { hit: FileSearchResult }) {
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
    <button type="button" onClick={() => app.openPdf(hit.filename, hit.page)} className={className}>
      {body}
    </button>
  ) : (
    <a href={`/api/attachments/${hit.id}?download=1`} className={className}>
      {body}
    </a>
  )
}

export function SearchView({ initialQuery }: { initialQuery: string }) {
  const app = useApp()
  const [query, setQuery] = useState(initialQuery)
  const [debounced, setDebounced] = useState(initialQuery)
  const { notes } = useNotes()
  const { data: folders = [] } = useFolders()

  const [prevInitial, setPrevInitial] = useState(initialQuery)
  if (prevInitial !== initialQuery) {
    setPrevInitial(initialQuery)
    setQuery(initialQuery)
  }
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query.trim())
      if (query !== initialQuery) app.go({ kind: 'search', q: query }, { replace: true })
    }, 250)
    return () => clearTimeout(t)
  }, [query, initialQuery, app])

  const search = useQuery({
    queryKey: keys.search(debounced),
    queryFn: () => api<SearchResponse>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
    staleTime: 5_000,
  })
  const results = search.data?.results ?? []
  const files = search.data?.files ?? []

  // Offline: zumindest Titel und Auszüge lokal durchsuchen
  const offlineResults = useMemo(() => {
    if (!(search.error instanceof NetworkError) || !debounced) return null
    const q = debounced.toLowerCase()
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.excerpt.toLowerCase().includes(q))
  }, [search.error, debounced, notes])

  return (
    <Page>
      <div className="relative mb-6">
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
      {!debounced ? (
        <EmptyState
          icon={<Search />}
          title="Volltextsuche"
          text="Durchsucht Notizen sowie PDFs und Textdateien. Mit #tag filterst du Notizen nach Tags."
        />
      ) : offlineResults ? (
        <>
          <p className="mb-3 flex items-center gap-2 text-sm text-warning">
            <CloudOff className="size-4" /> Offline – es werden nur Titel und Auszüge durchsucht.
          </p>
          <NoteList>
            {offlineResults.map((n) => (
              <NoteCard key={n.id} note={n} folders={folders} />
            ))}
          </NoteList>
        </>
      ) : search.isLoading ? (
        <div className="flex justify-center py-10 text-faint">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : results.length === 0 && files.length === 0 ? (
        <EmptyState icon={<Search />} title="Nichts gefunden" />
      ) : (
        <>
          {results.length > 0 ? (
            <>
              <p className="mb-3 text-sm text-muted">
                {results.length} {results.length === 1 ? 'Treffer' : 'Treffer'}
              </p>
              <NoteList>
                {results.map((r) => (
                  <NoteCard key={r.id} note={r} folders={folders} snippet={snippetHtml(r.snippet)} />
                ))}
              </NoteList>
            </>
          ) : null}
          {files.length > 0 ? (
            <section className={cn(results.length > 0 && 'mt-8')} aria-labelledby="search-files" data-testid="search-files">
              <h2 id="search-files" className="mb-3 text-sm text-muted">
                In Dateien
              </h2>
              <NoteList>
                {files.map((f) => (
                  <FileHit key={`${f.id}:${f.page}`} hit={f} />
                ))}
              </NoteList>
            </section>
          ) : null}
        </>
      )}
    </Page>
  )
}
