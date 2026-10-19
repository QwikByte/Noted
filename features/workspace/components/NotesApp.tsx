'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQueryClient } from '@tanstack/react-query'
import { Menu as MenuIcon, Plus, Search } from 'lucide-react'
import { AppContext, type AppActions, type CardEditorInit, type CardsFromNoteInit, type NewNoteOptions } from '../client/context'
import { Sidebar } from './Sidebar'
import { NoteView } from '@/features/notes/components/NoteView'
import { FolderView, TagView, SearchView } from '@/features/notes/components/views'
import { Dashboard } from './Dashboard'
import { TrashView } from '@/features/notes/components/TrashView'
import { FilesView } from '@/features/attachments/components/FilesView'
import { NewNoteDialog, MoveDialog, PromptDialog } from '@/features/notes/components/dialogs'
import { QuickSwitcher } from '@/features/notes/components/QuickSwitcher'
import { DragLayer } from '@/features/notes/components/DragLayer'
import { CardsView } from '@/features/flashcards/components/CardsView'
import { CalendarView } from '@/features/calendar/components/CalendarView'
import { DeckView } from '@/features/flashcards/components/DeckView'
import { StudyView } from '@/features/flashcards/components/StudyView'
import { QuizView } from '@/features/flashcards/components/QuizView'
import { GlossaryView } from '@/features/glossary/components/GlossaryView'
import { StatsView } from '@/features/flashcards/components/StatsView'
import { CardEditorDialog } from '@/features/flashcards/components/CardEditor'
import { CardsFromNoteDialog } from '@/features/flashcards/components/FromNoteDialog'
import { SplitPane } from '@/features/pdf/components/SplitPane'
import { Button } from '@/shared/ui/button'
import { ConfirmModal } from '@/shared/ui/modal'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { useReservedSpace } from '@/shared/ui/reserved-space'
import { useNav, type View } from '../client/nav'
import { usePref } from '@/shared/client/prefs'
import { applySavedNote, keys, removeNoteFromCache, useNotes } from '@/features/notes/client/queries'
import { api, errorMessage } from '@/shared/client/api'
import { sync } from '@/features/notes/client/sync'
import { useDefaultNoteFormat } from '@/features/notes/client/default-format'
import { linkKey } from '@/shared/markdown/meta'
import { validateName } from '@/shared/lib/names'
import type { Folder, NoteSummary } from '@/features/notes/types'

type MoveTarget = { kind: 'note'; note: NoteSummary } | { kind: 'folder'; folder: Folder }

// pdf.js wird erst geladen, wenn ein PDF geöffnet wird
const PdfPanel = dynamic(() => import('@/features/pdf/components/PdfPanel'), { ssr: false })

function readPdfPref(raw: string): { file: string } | null {
  try {
    const v = JSON.parse(raw)
    return typeof v?.file === 'string' ? { file: v.file } : null
  } catch {
    return null
  }
}

export default function NotesApp() {
  const { view, go } = useNav()
  const qc = useQueryClient()
  const toast = useToast()
  const { notes } = useNotes()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Verknüpfungen aus dem Manifest (/?new=1, /?new=lecture) öffnen direkt den Dialog
  const [newNote, setNewNote] = useState<NewNoteOptions | null>(() => {
    const n = new URLSearchParams(location.search).get('new')
    return n ? (n === '1' ? {} : { templateId: n }) : null
  })
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null)
  const [folderPrompt, setFolderPrompt] = useState<{ parentId: string | null } | { folder: Folder } | null>(null)
  const [renameTarget, setRenameTarget] = useState<NoteSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Folder | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [cardEditor, setCardEditor] = useState<{ init: CardEditorInit; n: number } | null>(null)
  const [fromNote, setFromNote] = useState<CardsFromNoteInit | null>(null)

  // PDF neben der aktuellen Ansicht – bleibt beim Wechseln der Notiz und nach dem Neuladen offen
  const [pdfPref, setPdfPref] = usePref<string>('noted:pdf', '')
  const [pdfJump, setPdfJump] = useState<{ page?: number; nonce: number }>({ nonce: 0 })
  const [pdfFull, setPdfFull] = usePref<'1' | '0'>('noted:pdfFull', '0')
  const [pdfSize, setPdfSize] = usePref<string>('noted:pdfSize', '50')
  const pdf = readPdfPref(pdfPref)

  // Gespeicherte Notizen in die Caches übernehmen
  useEffect(() => {
    let tagTimer: ReturnType<typeof setTimeout> | undefined
    const off = sync.onSaved((note, info) => {
      applySavedNote(qc, note)
      clearTimeout(tagTimer)
      tagTimer = setTimeout(() => qc.invalidateQueries({ queryKey: keys.tags }), 1500)
      if (info.linksUpdated > 0) {
        toast.show(`${info.linksUpdated} ${info.linksUpdated === 1 ? 'Link' : 'Links'} auf „${note.title}“ aktualisiert.`)
        qc.invalidateQueries({ queryKey: keys.notes })
        qc.invalidateQueries({ queryKey: ['note'] })
      }
    })
    return () => {
      off()
      clearTimeout(tagTimer)
    }
  }, [qc, toast])

  const titleIndex = useMemo(() => {
    const map = new Map<string, NoteSummary>()
    // Neueste zuerst, damit bei Namensgleichheit die zuletzt bearbeitete gewinnt
    for (const n of [...notes].sort((a, b) => a.updatedAt - b.updatedAt)) map.set(linkKey(n.title), n)
    return map
  }, [notes])

  const resolveTitle = useCallback((target: string) => titleIndex.get(linkKey(target)) ?? null, [titleIndex])

  const navigate = useCallback(
    (next: View, opts?: { replace?: boolean }) => {
      go(next, opts)
      setSidebarOpen(false)
      if (next.kind !== 'note') window.scrollTo({ top: 0 })
    },
    [go],
  )

  const [defaultFormat] = useDefaultNoteFormat()
  const createNote = useCallback<AppActions['createNote']>(
    async ({ title, folderId, content = '', format = defaultFormat }) => {
      const id = crypto.randomUUID()
      void sync.create({ id, title, folderId, content, format })
      navigate({ kind: 'note', id })
      return id
    },
    [navigate, defaultFormat],
  )

  // Editoren für formatierten Text, Mindmap und Canvas sowie die Formatumwandlung im Hintergrund laden – so cacht
  // sie der Service Worker und sie funktionieren auch offline
  useEffect(() => {
    const timer = setTimeout(() => {
      void import('@/features/notes/components/RichTextEditor').catch(() => {})
      void import('@/features/mindmap/components/MindmapEditor').catch(() => {})
      void import('@/features/canvas/components/CanvasEditor').catch(() => {})
      void import('@/features/notes/client/convert').catch(() => {})
    }, 5_000)
    return () => clearTimeout(timer)
  }, [])

  const trashNote = useCallback<AppActions['trashNote']>(
    async (note) => {
      const draft = sync.getDraft(note.id)
      if (draft?.isNew) {
        sync.discard(note.id)
        if (view.kind === 'note' && view.id === note.id) navigate({ kind: 'home' }, { replace: true })
        return
      }
      try {
        sync.discard(note.id)
        await api(`/api/notes/${note.id}`, { method: 'DELETE' })
        removeNoteFromCache(qc, note.id)
        qc.invalidateQueries({ queryKey: keys.trash })
        qc.invalidateQueries({ queryKey: keys.tags })
        if (view.kind === 'note' && view.id === note.id) navigate({ kind: 'home' }, { replace: true })
        toast.show(`„${note.title}“ in den Papierkorb verschoben.`, {
          action: {
            label: 'Rückgängig',
            onClick: async () => {
              await api(`/api/notes/${note.id}/restore`, { method: 'POST' })
              qc.invalidateQueries({ queryKey: keys.notes })
              qc.invalidateQueries({ queryKey: keys.trash })
            },
          },
        })
      } catch (err) {
        toast.error(errorMessage(err))
      }
    },
    [qc, toast, view, navigate],
  )

  const togglePin = useCallback<AppActions['togglePin']>(
    async (note) => {
      try {
        const res = await api<{ note: Parameters<typeof applySavedNote>[1] }>(`/api/notes/${note.id}`, {
          method: 'PUT',
          body: { pinned: !note.pinned },
        })
        applySavedNote(qc, res.note)
      } catch (err) {
        toast.error(errorMessage(err))
      }
    },
    [qc, toast],
  )

  const actions: AppActions = useMemo(
    () => ({
      view,
      go: navigate,
      openNewNote: (opts) => setNewNote(opts ?? {}),
      createNote,
      openQuickSwitcher: () => setSwitcherOpen(true),
      openMove: setMoveTarget,
      openNewFolder: (parentId) => setFolderPrompt({ parentId }),
      openRenameFolder: (folder) => setFolderPrompt({ folder }),
      deleteFolder: setDeleteTarget,
      trashNote,
      togglePin,
      renameNote: setRenameTarget,
      closeSidebar: () => setSidebarOpen(false),
      resolveTitle,
      openCardEditor: (init = {}) => setCardEditor((c) => ({ init, n: (c?.n ?? 0) + 1 })),
      openCardsFromNote: setFromNote,
      openPdf: (file, page) => {
        setPdfPref(JSON.stringify({ file }))
        setPdfJump((j) => ({ page, nonce: j.nonce + 1 }))
        setSidebarOpen(false)
      },
    }),
    [view, navigate, createNote, trashNote, togglePin, resolveTitle, setPdfPref],
  )

  // Tastenkürzel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'o' || e.key === 'p')) {
        e.preventDefault()
        setSwitcherOpen(true)
      } else if ((mod && e.altKey && e.key.toLowerCase() === 'n') || (e.altKey && !mod && e.code === 'KeyN')) {
        e.preventDefault()
        setNewNote({})
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        navigate({ kind: 'search', q: '' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  useEffect(() => {
    if (new URLSearchParams(location.search).has('new')) window.history.replaceState(null, '', '/')
  }, [])

  const currentFolderId =
    view.kind === 'folder'
      ? view.id
      : view.kind === 'note'
        ? (notes.find((n) => n.id === view.id)?.folderId ?? null)
        : null

  let main: React.ReactNode
  switch (view.kind) {
    case 'note':
      main = <NoteView key={view.id} id={view.id} heading={view.heading} onOpenSidebar={() => setSidebarOpen(true)} />
      break
    case 'folder':
      main = <FolderView id={view.id} />
      break
    case 'tag':
      main = <TagView tag={view.tag} />
      break
    case 'search':
      main = <SearchView initialQuery={view.q} />
      break
    case 'trash':
      main = <TrashView />
      break
    case 'files':
      main = <FilesView key={view.folder ?? ''} folder={view.folder} />
      break
    case 'cards':
      main = <CardsView />
      break
    case 'calendar':
      main = <CalendarView />
      break
    case 'deck':
      main = <DeckView key={view.id} id={view.id} />
      break
    case 'study':
      main = <StudyView key={`${view.scope}:${view.mode}`} scope={view.scope} mode={view.mode} />
      break
    case 'quiz':
      main = <QuizView key={view.id} id={view.id} />
      break
    case 'stats':
      main = <StatsView />
      break
    case 'glossary':
      main = <GlossaryView key={view.folder ?? ''} folder={view.folder} />
      break
    default:
      main = <Dashboard />
  }

  const showTopBar = view.kind !== 'note' && view.kind !== 'study' && view.kind !== 'quiz'
  const showFab = showTopBar && !pdf && !['trash', 'cards', 'deck', 'calendar', 'stats'].includes(view.kind)
  // Werkzeugleiste und Mini-Timer weichen der Seitenleiste und dem Knopf „Neue Notiz“ aus
  const sidebarSpace = useReservedSpace<HTMLElement>('--sidebar-width')
  const fabSpace = useReservedSpace<HTMLButtonElement>('--bottom-right-height')

  return (
    <AppContext.Provider value={actions}>
      <div className="flex h-dvh overflow-hidden bg-bg">
        {/* Seitenleiste: Desktop fest, mobil als Schublade */}
        <aside ref={sidebarSpace} className="hidden w-72 shrink-0 border-r border-border bg-sidebar lg:flex lg:flex-col xl:w-80">
          <Sidebar currentFolderId={currentFolderId} />
        </aside>
        {sidebarOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 animate-fade-in bg-black/40" onClick={() => setSidebarOpen(false)} />
            <aside className="pt-safe absolute inset-y-0 left-0 flex w-[86%] max-w-80 animate-slide-in-left flex-col bg-sidebar shadow-pop">
              <Sidebar currentFolderId={currentFolderId} />
            </aside>
          </div>
        ) : null}

        <main className="relative flex min-w-0 flex-1 flex-col">
          {showTopBar ? (
            <header className="pt-safe border-b border-border lg:hidden">
              <div className="flex h-12 items-center gap-1 px-2">
                <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} aria-label="Menü öffnen">
                  <MenuIcon className="size-5" />
                </Button>
                <span className="flex-1 truncate px-1 font-semibold">Noted</span>
                <Button variant="ghost" size="icon" onClick={() => setSwitcherOpen(true)} aria-label="Suchen">
                  <Search className="size-5" />
                </Button>
              </div>
            </header>
          ) : null}
          <SplitPane
            main={main}
            side={
              pdf ? (
                <PdfPanel
                  file={pdf.file}
                  page={pdfJump.page}
                  nonce={pdfJump.nonce}
                  full={pdfFull === '1'}
                  onToggleFull={() => setPdfFull(pdfFull === '1' ? '0' : '1')}
                  onClose={() => {
                    setPdfPref('')
                    setPdfFull('0')
                  }}
                  onOpen={(file, page) => actions.openPdf(file, page)}
                />
              ) : null
            }
            full={pdfFull === '1'}
            size={Number(pdfSize) || 50}
            onResize={(n) => setPdfSize(String(n))}
          />
          {showFab ? (
            <button
              ref={fabSpace}
              type="button"
              onClick={() => setNewNote({ folderId: currentFolderId })}
              className={cn(
                'fixed right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-pop transition hover:bg-accent-hover active:scale-95 lg:hidden',
              )}
              aria-label="Neue Notiz"
            >
              <Plus className="size-6" />
            </button>
          ) : null}
        </main>
      </div>

      <NewNoteDialog options={newNote} onClose={() => setNewNote(null)} />
      {cardEditor ? <CardEditorDialog key={cardEditor.n} init={cardEditor.init} onClose={() => setCardEditor(null)} /> : null}
      {fromNote ? <CardsFromNoteDialog note={fromNote} onClose={() => setFromNote(null)} /> : null}
      <QuickSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      <DragLayer />
      <MoveDialog target={moveTarget} onClose={() => setMoveTarget(null)} />
      <PromptDialog
        open={!!folderPrompt}
        title={folderPrompt && 'folder' in folderPrompt ? 'Ordner umbenennen' : 'Neuer Ordner'}
        label="Name"
        initialValue={folderPrompt && 'folder' in folderPrompt ? folderPrompt.folder.name : ''}
        confirmLabel={folderPrompt && 'folder' in folderPrompt ? 'Umbenennen' : 'Anlegen'}
        validate={validateName}
        onClose={() => setFolderPrompt(null)}
        onSubmit={async (name) => {
          if (!folderPrompt) return
          if ('folder' in folderPrompt) {
            await api(`/api/folders/${folderPrompt.folder.id}`, { method: 'PATCH', body: { name } })
          } else {
            await api('/api/folders', { method: 'POST', body: { name, parentId: folderPrompt.parentId } })
          }
          await qc.invalidateQueries({ queryKey: keys.folders })
          setFolderPrompt(null)
        }}
      />
      <PromptDialog
        open={!!renameTarget}
        title="Notiz umbenennen"
        label="Titel"
        initialValue={renameTarget?.title ?? ''}
        confirmLabel="Umbenennen"
        validate={validateName}
        onClose={() => setRenameTarget(null)}
        onSubmit={async (title) => {
          if (!renameTarget) return
          sync.update(renameTarget.id, renameTarget.version, { title }, { immediate: true })
          setRenameTarget(null)
        }}
      />
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Ordner löschen?"
        description={
          deleteTarget
            ? `„${deleteTarget.name}“ und alle Unterordner werden gelöscht. Enthaltene Notizen landen im Papierkorb.`
            : undefined
        }
        confirmLabel="Löschen"
        danger
        loading={deleting}
        onConfirm={async () => {
          if (!deleteTarget) return
          setDeleting(true)
          try {
            const res = await api<{ trashedNotes: number }>(`/api/folders/${deleteTarget.id}`, { method: 'DELETE' })
            await Promise.all([
              qc.invalidateQueries({ queryKey: keys.folders }),
              qc.invalidateQueries({ queryKey: keys.notes }),
              qc.invalidateQueries({ queryKey: keys.trash }),
            ])
            if (view.kind === 'folder' && view.id === deleteTarget.id) navigate({ kind: 'home' }, { replace: true })
            toast.success(
              res.trashedNotes
                ? `Ordner gelöscht – ${res.trashedNotes} ${res.trashedNotes === 1 ? 'Notiz' : 'Notizen'} im Papierkorb.`
                : 'Ordner gelöscht.',
            )
            setDeleteTarget(null)
          } catch (err) {
            toast.error(errorMessage(err))
          } finally {
            setDeleting(false)
          }
        }}
      />
    </AppContext.Provider>
  )
}
