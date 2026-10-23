'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQueryClient } from '@tanstack/react-query'
import { Menu as MenuIcon, Plus, Search } from 'lucide-react'
import {
  AppContext,
  type AppActions,
  type CardEditorInit,
  type CardsFromNoteInit,
  type MoveTarget,
  type NewNoteOptions,
} from '../client/context'
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
import { ContextMenuProvider, useContextMenu } from '@/shared/ui/menu'
import { CreateMenuItems, isEmptySpot } from '@/features/notes/components/ItemMenus'
import { ConfirmModal } from '@/shared/ui/modal'
import { openPrintShortcut } from '@/shared/ui/print-view'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { useReservedSpace } from '@/shared/ui/reserved-space'
import { useNav, type View } from '../client/nav'
import { usePref } from '@/shared/client/prefs'
import {
  applySavedNote,
  keys,
  removeNoteFromCache,
  useFolders,
  useNotes,
  useVaultNoteIds,
} from '@/features/notes/client/queries'
import { graphKey } from '@/features/graph/client/queries'
import { api, errorMessage } from '@/shared/client/api'
import { sync } from '@/features/notes/client/sync'
import { notesLabel, postNoteBatch } from '@/features/notes/client/bulk'
import { useDefaultNoteFormat } from '@/features/notes/client/default-format'
import { linkKey } from '@/shared/markdown/meta'
import { validateName } from '@/shared/lib/names'
import { useVaultInfo, useVaultState, vault } from '@/features/vault/client/vault'
import {
  createVaultFolder,
  createVaultNote,
  purgeCachedPlaintext,
  renameVaultFolder,
  sealPlainDrafts,
  updateVaultNote,
} from '@/features/vault/client/vault-notes'
import { requestVault } from '@/features/vault/client/vault-ui'
import { VaultDialogs } from '@/features/vault/components/VaultDialogs'
import type { Folder, Note, NoteSummary } from '@/features/notes/types'

// pdf.js wird erst geladen, wenn ein PDF geöffnet wird
const PdfPanel = dynamic(() => import('@/features/pdf/components/PdfPanel'), { ssr: false })
// React Flow für den Graphen ebenfalls erst bei Bedarf
const GraphView = dynamic(() => import('@/features/graph/components/GraphView'), { ssr: false })

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
  const { data: folders = [] } = useFolders()
  const vaultIds = useVaultNoteIds()
  const { unlocked } = useVaultState()
  // Schlüsselmaterial gleich laden: So liegt es im Cache des Service Workers, und Entsperren geht später auch offline
  useVaultInfo()

  // Klartext aufräumen, den dieses Gerät von Notizen hat, die inzwischen im Tresor liegen (Cache des Service Workers,
  // Entwürfe) – Entwürfe lassen sich erst entsperrt verschlüsseln
  useEffect(() => {
    if (vaultIds.length === 0) return
    void purgeCachedPlaintext(vaultIds).then((found) => {
      if (found) void qc.invalidateQueries({ queryKey: keys.tags })
    })
    if (unlocked) void sealPlainDrafts(new Set(vaultIds))
  }, [vaultIds, unlocked, qc])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Verknüpfungen aus dem Manifest (/?new=1, /?new=lecture) öffnen direkt den Dialog
  const [newNote, setNewNote] = useState<NewNoteOptions | null>(() => {
    const n = new URLSearchParams(location.search).get('new')
    return n ? (n === '1' ? {} : { templateId: n }) : null
  })
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<{ target: MoveTarget; onMoved?: () => void } | null>(null)
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
      tagTimer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: keys.tags })
        qc.invalidateQueries({ queryKey: graphKey })
      }, 1500)
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

  // Tresor-Notizen getrennt: Nur Links aus dem Tresor finden sie (dort gehen sie bei Namensgleichheit vor)
  const titleIndex = useMemo(() => {
    const plain = new Map<string, NoteSummary>()
    const inVault = new Map<string, NoteSummary>()
    // Neueste zuerst, damit bei Namensgleichheit die zuletzt bearbeitete gewinnt
    for (const n of [...notes].sort((a, b) => a.updatedAt - b.updatedAt)) {
      const index = n.vault ? inVault : plain
      index.set(linkKey(n.title), n)
    }
    return { plain, inVault }
  }, [notes])

  const resolveTitle = useCallback<AppActions['resolveTitle']>(
    (target, opts) => {
      const key = linkKey(target)
      return (opts?.vault ? titleIndex.inVault.get(key) : undefined) ?? titleIndex.plain.get(key) ?? null
    },
    [titleIndex],
  )

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
      // Ungültige Titel nicht als Entwurf anlegen: Der Server lehnte ihn ab, im Tresor prüft ihn niemand
      const invalid = validateName(title)
      if (invalid) throw new Error(invalid)
      // Ungefilterte Ordner: Gesperrt fehlen die Unterordner des Tresors in der Liste
      const inVault = !!folderId && !!qc.getQueryData<Folder[]>(keys.folders)?.find((f) => f.id === folderId)?.vault
      let id: string
      if (inVault) {
        if (!vault.unlocked) {
          requestVault({ kind: 'unlock' })
          throw new Error('Entsperre zuerst den Tresor.')
        }
        id = await createVaultNote({ title, folderId, content, format })
      } else {
        id = crypto.randomUUID()
        void sync.create({ id, title, folderId, content, format })
      }
      navigate({ kind: 'note', id })
      return id
    },
    [navigate, defaultFormat, qc],
  )

  // Editoren für formatierten Text, Mindmap und Canvas sowie die Formatumwandlung im Hintergrund laden – so cacht
  // sie der Service Worker und sie funktionieren auch offline
  useEffect(() => {
    const preload = () => {
      void import('@/features/notes/components/RichTextEditor').catch(() => {})
      void import('@/features/mindmap/components/MindmapEditor').catch(() => {})
      void import('@/features/canvas/components/CanvasEditor').catch(() => {})
      void import('@/features/graph/components/GraphView').catch(() => {})
      void import('@/features/notes/client/convert').catch(() => {})
    }
    // Offline erst, wenn wieder Netz da ist – sonst schlagen die Anfragen nur fehl und es bleibt nichts im Cache
    const timer = setTimeout(() => {
      if (navigator.onLine) preload()
      else window.addEventListener('online', preload, { once: true })
    }, 5_000)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', preload)
    }
  }, [])

  const trashNotes = useCallback<AppActions['trashNotes']>(
    async (list) => {
      // Noch nie gesendete Notizen gibt es auf dem Server nicht – sie werden nur lokal verworfen
      const local = list.filter((n) => sync.getDraft(n.id)?.isNew)
      const remote = list.filter((n) => !sync.getDraft(n.id)?.isNew)
      let ids: string[] = []
      if (remote.length > 0) {
        try {
          ids = await postNoteBatch('trash', remote.map((n) => n.id))
        } catch (err) {
          // Offline bleibt alles, wie es ist – auch ungesendete Änderungen
          toast.error(errorMessage(err))
          return false
        }
      }
      for (const n of [...local, ...remote]) {
        sync.discard(n.id)
        removeNoteFromCache(qc, n.id)
      }
      if (remote.length > 0) {
        qc.invalidateQueries({ queryKey: keys.trash })
        qc.invalidateQueries({ queryKey: keys.tags })
        qc.invalidateQueries({ queryKey: graphKey })
        qc.invalidateQueries({ queryKey: ['search'] })
      }
      if (view.kind === 'note' && list.some((n) => n.id === view.id)) navigate({ kind: 'home' }, { replace: true })
      const trashed = remote.filter((n) => ids.includes(n.id))
      if (trashed.length > 0) {
        toast.show(`${notesLabel(trashed)} in den Papierkorb verschoben.`, {
          action: {
            label: 'Rückgängig',
            onClick: async () => {
              try {
                await postNoteBatch('restore', ids)
                qc.invalidateQueries({ queryKey: keys.notes })
                qc.invalidateQueries({ queryKey: keys.trash })
                qc.invalidateQueries({ queryKey: keys.tags })
                qc.invalidateQueries({ queryKey: graphKey })
              } catch (err) {
                toast.error(`Wiederherstellen fehlgeschlagen: ${errorMessage(err)}`)
              }
            },
          },
        })
      }
      return true
    },
    [qc, toast, view, navigate],
  )

  const pinNotes = useCallback<AppActions['pinNotes']>(
    async (list, pinned) => {
      try {
        const ids = new Set(await postNoteBatch(pinned ? 'pin' : 'unpin', list.map((n) => n.id)))
        // Version und Bearbeitungszeit bleiben gleich – die Caches direkt anpassen statt neu zu laden
        qc.setQueryData<NoteSummary[]>(keys.notes, (all) => all?.map((n) => (ids.has(n.id) ? { ...n, pinned } : n)))
        for (const id of ids) qc.setQueryData<Note>(keys.note(id), (n) => (n ? { ...n, pinned } : n))
        return true
      } catch (err) {
        toast.error(errorMessage(err))
        return false
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
      openMove: (target, opts) => setMoveTarget({ target, onMoved: opts?.onMoved }),
      openNewFolder: (parentId) => setFolderPrompt({ parentId }),
      openRenameFolder: (folder) => setFolderPrompt({ folder }),
      deleteFolder: setDeleteTarget,
      trashNotes,
      pinNotes,
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
    [view, navigate, createNote, trashNotes, pinNotes, resolveTitle, setPdfPref],
  )

  // Tastenkürzel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      // In Notiz, Glossar und Stapel öffnet Strg/⌘+P die Druckansicht
      if (mod && !e.shiftKey && e.key === 'p' && openPrintShortcut()) {
        e.preventDefault()
        return
      }
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

  // Schublade mit der Seitenleiste (Handy): Escape schließt sie wie einen Dialog
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

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
    case 'graph':
      main = <GraphView />
      break
    default:
      main = <Dashboard />
  }

  const showTopBar = view.kind !== 'note' && view.kind !== 'study' && view.kind !== 'quiz'
  const showFab = showTopBar && !pdf && !['trash', 'cards', 'deck', 'calendar', 'stats', 'graph'].includes(view.kind)
  // Der Mini-Timer steht rechts neben der Seitenleiste
  const sidebarSpace = useReservedSpace<HTMLElement>('--sidebar-width')

  return (
    <AppContext.Provider value={actions}>
      {/* Eigene Ebene für Kontextmenüs: Ihre Einträge brauchen die Aktionen der App (useApp) */}
      <ContextMenuProvider>
        <div className="flex h-dvh overflow-hidden bg-bg">
          {/* Für die Tastatur: an Suche, Navigation und Ordnerbaum vorbei direkt zum Inhalt */}
          <a
            href="#main"
            className="sr-only z-50 rounded-lg bg-elevated px-3 py-2 text-sm font-medium shadow-pop focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
          >
            Zum Inhalt springen
          </a>
          {/* Seitenleiste: Desktop fest, mobil als Schublade */}
          <aside ref={sidebarSpace} className="hidden w-72 shrink-0 border-r border-border bg-sidebar lg:flex lg:flex-col xl:w-80">
            <Sidebar currentFolderId={currentFolderId} />
          </aside>
          {sidebarOpen ? (
            <div className="fixed inset-0 z-40 lg:hidden">
              <div className="absolute inset-0 animate-fade-in bg-black/40" onClick={() => setSidebarOpen(false)} />
              <aside
                className="pt-safe absolute inset-y-0 left-0 flex w-[86%] max-w-80 animate-slide-in-left flex-col overscroll-contain bg-sidebar shadow-pop"
                aria-label="Navigation"
              >
                <Sidebar currentFolderId={currentFolderId} />
              </aside>
            </div>
          ) : null}

          <MainArea folderId={currentFolderId}>
            {showTopBar ? (
              <header className="pt-safe border-b border-border lg:hidden">
                <div className="flex h-12 items-center gap-1 px-2">
                  <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} aria-label="Menü öffnen" aria-expanded={sidebarOpen}>
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
          </MainArea>
        </div>

        <NewNoteDialog options={newNote} onClose={() => setNewNote(null)} />
        {cardEditor ? <CardEditorDialog key={cardEditor.n} init={cardEditor.init} onClose={() => setCardEditor(null)} /> : null}
        {fromNote ? <CardsFromNoteDialog note={fromNote} onClose={() => setFromNote(null)} /> : null}
        <QuickSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
        <DragLayer />
        <VaultDialogs />
        <MoveDialog target={moveTarget?.target ?? null} onMoved={moveTarget?.onMoved} onClose={() => setMoveTarget(null)} />
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
            // Im Tresor nur verschlüsselte Namen
            const parent = 'folder' in folderPrompt ? null : folders.find((f) => f.id === folderPrompt.parentId)
            if ('folder' in folderPrompt && folderPrompt.folder.vault) {
              await renameVaultFolder(folderPrompt.folder.id, name)
            } else if ('folder' in folderPrompt) {
              await api(`/api/folders/${folderPrompt.folder.id}`, { method: 'PATCH', body: { name } })
            } else if (parent?.vault) {
              await createVaultFolder(name, parent.id)
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
            if (renameTarget.vault) await updateVaultNote(renameTarget.id, renameTarget.version, { title }, { immediate: true })
            else sync.update(renameTarget.id, renameTarget.version, { title }, { immediate: true })
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
                qc.invalidateQueries({ queryKey: graphKey }),
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
      </ContextMenuProvider>
    </AppContext.Provider>
  )
}

/** Hauptbereich. Rechtsklick auf freie Fläche: neu anlegen und suchen – Bereiche mit eigenem Menü gehen vor. */
function MainArea({ folderId, children }: { folderId: string | null; children: React.ReactNode }) {
  const openContextMenu = useContextMenu()
  return (
    <main
      id="main"
      tabIndex={-1}
      className="relative flex min-w-0 flex-1 flex-col outline-none"
      onContextMenu={(e) => openContextMenu(e, isEmptySpot(e.target) ? <CreateMenuItems folderId={folderId} /> : null)}
    >
      {children}
    </main>
  )
}
