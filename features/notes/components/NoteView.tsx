'use client'
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import type { EditorView } from '@codemirror/view'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Cloud,
  CloudOff,
  Columns2,
  Copy,
  Download,
  Dumbbell,
  FileText,
  FolderInput,
  GraduationCap,
  History,
  Info,
  Layers,
  Link2,
  ListChecks,
  Loader2,
  Lock,
  Menu as MenuIcon,
  MoreVertical,
  PenLine,
  Pin,
  PinOff,
  Printer,
  Share2,
  TableOfContents,
  Trash2,
  Type,
  Upload,
} from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { NavLink } from '@/features/workspace/components/NavLink'
import { Editor, type EditorHandle } from './Editor'
import { EditorToolbar } from './EditorToolbar'
import { Preview, type PreviewLinks } from './Preview'
import { NotePrint } from './NotePrint'
import { NoteOutline, OUTLINE_BESIDE_WIDTH } from './NoteOutline'
import { PlainTextView, RichTextView } from './ReadView'
import { FormatDialog } from './FormatPicker'
import { HistoryDialog } from './dialogs'
import { ShareDialog } from '@/features/sharing/components/ShareDialog'
import { useSharingEnabled } from '@/features/sharing/client/enabled'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Menu, MenuItem, MenuLabel, MenuSeparator, useContextMenu } from '@/shared/ui/menu'
import { MarkdownEditorMenu, ReadViewMenu } from './EditorMenuItems'
import { cardFromSelection } from '@/features/flashcards/components/CardEditor'
import { Modal } from '@/shared/ui/modal'
import { usePrintShortcut } from '@/shared/ui/print-view'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { useBacklinks, useDrafts, useFolders, useNote, useNotes, useTags } from '../client/queries'
import { attachmentsKey, useAttachments } from '@/features/attachments/client/queries'
import { conflictCopyTitle, sync, type NoteSyncStatus } from '../client/sync'
import { usePref, type EditorMode } from '@/shared/client/prefs'
import { copyHtml, copyText } from '@/shared/client/clipboard'
import { folderPath } from '../tree'
import { formatDateTime, formatRelative, wordCount } from '@/shared/lib/format'
import { attachmentMarkdown, niceFileName, uploadAttachment } from '@/features/attachments/client/upload'
import type { Attachment } from '@/features/attachments/types'
import { errorMessage, ApiError } from '@/shared/client/api'
import { useFlashcards } from '@/features/flashcards/client/flashcards'
import { insertionToMarkdown, registerActiveEditor } from '../client/active-editor'
import type { NoteEditorHandle, RichTextHandle } from '../client/editor-handle'
import { revealEntry, revealLine, useOutlineSpy } from '../client/outline-spy'
import { hasOutline, noteOutline, type OutlineEntry } from '../outline'
import { attachmentHtml, insertionToHtml, linkedPdfs } from '../rich-html'
import { NOTE_FORMAT_LABELS, isVisualFormat, noteExtension, noteText } from '../format'
import { htmlDocument, htmlToText } from '@/shared/lib/html'
import { extractLinks, findHeadingLine, findWikiLinks, headingKey, splitFrontmatter } from '@/shared/markdown/meta'
import { canvasForExport, canvasToMarkdown, parseCanvas } from '@/features/canvas/canvas'
import { buildExportIndex } from '@/features/transfer/paths'
import { EXPLICIT_SOURCES, parseCardsFromNote } from '@/features/flashcards/card-markdown'
import { canQuiz } from '@/features/flashcards/note-quiz'
import { validateName } from '@/shared/lib/names'
import {
  clearPendingHeading,
  createVaultNote,
  pendingHeading,
  rememberPlain,
  revealNote,
  setPendingHeading,
  updateVaultNote,
  useRevealedNote,
} from '@/features/vault/client/vault-notes'
import { requestVault } from '@/features/vault/client/vault-ui'
import { VaultMoveItem } from '@/features/vault/components/VaultMoveItem'
import type { Note, NoteFormat } from '../types'

const VAULT_UPLOAD_BLOCKED = 'Dateien lassen sich im Tresor noch nicht verschlüsselt speichern.'

const editorLoading = () => (
  <div className="flex flex-1 items-center justify-center text-muted">
    <Loader2 className="size-5 animate-spin" />
  </div>
)
// Editoren für formatierten Text, Mindmap und Canvas erst laden, wenn sie gebraucht werden (TipTap und React Flow
// sind groß)
const RichTextEditor = dynamic(() => import('./RichTextEditor'), { ssr: false, loading: editorLoading })
const MindmapEditor = dynamic(() => import('@/features/mindmap/components/MindmapEditor'), {
  ssr: false,
  loading: editorLoading,
})
const CanvasEditor = dynamic(() => import('@/features/canvas/components/CanvasEditor'), {
  ssr: false,
  loading: editorLoading,
})
const LocalGraph = dynamic(() => import('@/features/graph/components/GraphView').then((m) => m.LocalGraph), {
  ssr: false,
  loading: editorLoading,
})

function useSyncStatus(id: string): NoteSyncStatus {
  return useSyncExternalStore(
    sync.subscribe,
    () => sync.getStatus(id),
    () => sync.getStatus(id),
  )
}

/**
 * Breit genug, z. B. für Editor und Vorschau nebeneinander oder die Gliederung neben dem Blatt? Gemessen am eigenen
 * Bereich (daneben kann ein PDF offen sein).
 */
function useIsWide(ref: React.RefObject<HTMLElement | null>, minWidth: number) {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= minWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, minWidth])
  return wide
}

function StatusIndicator({ status }: { status: NoteSyncStatus }) {
  const map = {
    saved: { icon: <Check className="size-3.5" />, label: 'Gespeichert', cls: 'text-faint' },
    pending: { icon: <Cloud className="size-3.5" />, label: 'Ungespeichert', cls: 'text-faint' },
    saving: { icon: <Loader2 className="size-3.5 animate-spin" />, label: 'Speichert …', cls: 'text-faint' },
    offline: { icon: <CloudOff className="size-3.5" />, label: 'Offline – lokal gesichert', cls: 'text-warning' },
    conflict: { icon: <AlertTriangle className="size-3.5" />, label: 'Konflikt', cls: 'text-danger' },
    error: { icon: <AlertTriangle className="size-3.5" />, label: 'Fehler', cls: 'text-danger' },
  }[status.state]
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs whitespace-nowrap', map.cls)}
      title={status.error ?? map.label}
      data-testid="save-status"
    >
      {map.icon}
      {/* Auf dem Handy nur das Symbol – vorlesbar bleibt der Zustand trotzdem. Bewusst keine Live-Region: Beim Tippen
          würde sonst jedes Speichern angesagt */}
      <span className="sr-only sm:not-sr-only">{map.label}</span>
    </span>
  )
}

/** Lädt die Notiz (Server oder lokaler Entwurf) und zeigt dann den Editor. */
export function NoteView({ id, heading, onOpenSidebar }: { id: string; heading?: string; onOpenSidebar: () => void }) {
  const drafts = useDrafts()
  const draft = drafts.find((d) => d.id === id)
  const isLocalOnly = !!draft?.isNew
  const query = useNote(id, !isLocalOnly)
  const app = useApp()

  const base: Note | null = useMemo(() => {
    if (query.data) return query.data
    if (isLocalOnly && draft) {
      return {
        id,
        title: draft.title ?? 'Unbenannt',
        folderId: draft.folderId ?? null,
        content: draft.content ?? '',
        format: draft.format ?? 'markdown',
        pinned: false,
        version: 0,
        createdAt: draft.updatedAt,
        updatedAt: draft.updatedAt,
        tags: [],
        excerpt: '',
        vault: !!draft.vault,
        titleEnc: draft.titleEnc ?? null,
      }
    }
    return null
    // Nur beim ersten Laden relevant – spätere Änderungen verwaltet der Editor selbst
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, isLocalOnly, id])

  if (!base) {
    const notFound = query.error instanceof ApiError && query.error.status === 404
    return (
      <NoteMessage onOpenSidebar={onOpenSidebar}>
        {query.isLoading ? (
          <Loader2 className="size-6 animate-spin" />
        ) : (
          <div className="space-y-3">
            <FileText className="mx-auto size-10 text-faint" />
            <p>{notFound ? 'Diese Notiz gibt es nicht (mehr).' : `Die Notiz konnte nicht geladen werden. ${errorMessage(query.error)}`}</p>
            <Button onClick={() => app.go({ kind: 'home' })}>Zur Startseite</Button>
          </div>
        )}
      </NoteMessage>
    )
  }
  if (base.vault) {
    return <VaultNote note={base} serverNote={query.data ?? null} heading={heading} onOpenSidebar={onOpenSidebar} />
  }
  return <NoteEditor note={base} serverNote={query.data ?? null} heading={heading} />
}

/** Statt der Notiz: Laden, Fehler, gesperrt */
function NoteMessage({ onOpenSidebar, children }: { onOpenSidebar: () => void; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="pt-safe border-b border-border lg:hidden">
        <div className="flex h-12 items-center px-2">
          <Button variant="ghost" size="icon" onClick={onOpenSidebar} aria-label="Menü öffnen">
            <MenuIcon className="size-5" />
          </Button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center p-8 text-center text-muted">{children}</div>
    </div>
  )
}

/**
 * Tresor-Notiz: erst entschlüsseln, dann der Editor mit dem Klartext. Gesperrt (auch nach dem automatischen Sperren)
 * wird sie geschlossen; beschädigt wird sie nicht geöffnet – sonst überschriebe das Speichern sie.
 */
function VaultNote({
  note,
  serverNote,
  heading,
  onOpenSidebar,
}: {
  note: Note
  serverNote: Note | null
  heading?: string
  onOpenSidebar: () => void
}) {
  const revealed = useRevealedNote(note, serverNote)
  const [jump] = useState(() => heading ?? pendingHeading(note.id))
  useEffect(() => clearPendingHeading(note.id), [note.id])
  // Basis für die Konflikterkennung, auch solange der neueste Stand noch entschlüsselt wird
  useEffect(() => {
    if (serverNote) sync.setKnownVersion(serverNote.id, serverNote.version)
  }, [serverNote])

  if (revealed.state === 'ready') return <NoteEditor note={revealed.note} serverNote={revealed.server} heading={jump} />
  return (
    <NoteMessage onOpenSidebar={onOpenSidebar}>
      {revealed.state === 'loading' ? (
        <Loader2 className="size-6 animate-spin" />
      ) : revealed.state === 'locked' ? (
        <div className="space-y-3" data-testid="vault-note-locked">
          <Lock className="mx-auto size-10 text-faint" />
          <p>Gesperrt – diese Notiz liegt im Tresor.</p>
          <Button variant="primary" onClick={() => requestVault({ kind: 'unlock' })}>
            Entsperren
          </Button>
        </div>
      ) : (
        <div className="max-w-md space-y-3" role="alert" data-testid="vault-note-corrupt">
          <AlertTriangle className="mx-auto size-10 text-danger" />
          <p>{revealed.message}</p>
        </div>
      )}
    </NoteMessage>
  )
}

/** Überschrift im gerenderten Inhalt (Lesemodus, Vorschau, formatierter Text) – nicht der Titel der Notiz */
function headingElement(root: HTMLElement | null, heading: string): HTMLElement | null {
  const key = headingKey(heading)
  const all = root?.querySelectorAll<HTMLElement>(
    ':is(.markdown-body, .ProseMirror) :is(h1, h2, h3, h4, h5, h6)',
  )
  return [...(all ?? [])].find((h) => headingKey(h.textContent ?? '') === key) ?? null
}

function NoteEditor({ note, serverNote, heading }: { note: Note; serverNote: Note | null; heading?: string }) {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  // Markdown und einfacher Text: CodeMirror · formatierter Text: TipTap · Mindmap und Canvas: React Flow
  const cmRef = useRef<EditorHandle>(null)
  const richRef = useRef<RichTextHandle>(null)
  const visualRef = useRef<NoteEditorHandle>(null)
  const { notes } = useNotes()
  const { data: folders = [] } = useFolders()
  const { data: tags = [] } = useTags()
  const { data: attachments = [] } = useAttachments()
  const status = useSyncStatus(note.id)
  const rootRef = useRef<HTMLDivElement>(null)
  const isWide = useIsWide(rootRef, 960)
  const outlineWide = useIsWide(rootRef, OUTLINE_BESIDE_WIDTH)
  // Bereich unter dem Kopf: Gliederung, Werkzeugleiste, Editor und Vorschau
  const contentRef = useRef<HTMLDivElement>(null)
  const pdfInput = useRef<HTMLInputElement>(null)

  // Tresor-Notiz: Der Entwurf ist verschlüsselt und steckt schon entschlüsselt in `note`
  const inVault = note.vault
  const initialDraft = inVault ? undefined : sync.getDraft(note.id)
  const [content, setContent] = useState(initialDraft?.content ?? note.content)
  const [format, setFormat] = useState<NoteFormat>(initialDraft?.format ?? note.format)
  const [title, setTitle] = useState(initialDraft?.title ?? note.title)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [storedMode, setStoredMode] = usePref<EditorMode>('noted:mode', 'edit')
  const [mode, setModeState] = useState<EditorMode>(() => (note.content.trim() === '' ? 'edit' : storedMode))
  const [infoOpen, setInfoOpen] = useState(false)
  const [formatOpen, setFormatOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  // Strg/⌘+P: Druckansicht statt Schnellwechsler
  usePrintShortcut(() => setPrintOpen(true))
  const sharing = useSharingEnabled()
  const [spellcheck] = usePref<'1' | '0'>('noted:spellcheck', '1')
  const [slashCommands] = usePref<'1' | '0'>('noted:slashCommands', '1')
  const loadedVersion = useRef(note.version)
  const summary = notes.find((n) => n.id === note.id)
  const folderId = summary?.folderId ?? note.folderId
  // Geteilte Ansicht: Markdown mit Vorschau, Mindmap mit ihrer Gliederung als Text – bei den anderen Formaten sieht
  // der Editor schon aus wie das Ergebnis
  const canSplit = isWide && (format === 'markdown' || format === 'mindmap')
  const visual = isVisualFormat(format)
  const effectiveMode: EditorMode = mode === 'split' && !canSplit ? 'edit' : mode
  const text = useMemo(() => noteText(format, content), [format, content])

  const setMode = (m: EditorMode) => {
    setModeState(m)
    setStoredMode(m)
  }

  // Gliederung: auf breiten Flächen als Spalte neben dem Blatt (ein- und ausblendbar, auf dem Gerät gemerkt), sonst
  // als Overlay darüber, das nach jedem Öffnen der Notiz zu ist
  const [outlinePref, setOutlinePref] = usePref<'1' | '0'>('noted:outline', '0')
  const [outlineOverlay, setOutlineOverlay] = useState(false)
  // Per Tastatur geöffnet: Fokus auf den aktuellen Eintrag – nur bis die Liste wieder zu ist
  const [outlineFocus, setOutlineFocus] = useState(false)
  const outlineId = useId()
  const outlineButton = useRef<HTMLButtonElement>(null)
  const withOutline = hasOutline(format)
  const outlineBeside = outlineWide && effectiveMode !== 'split'
  const outlineOpen = withOutline && (outlineBeside ? outlinePref === '1' : outlineOverlay)
  if (!outlineOpen && outlineFocus) setOutlineFocus(false)

  function toggleOutline(e: React.MouseEvent) {
    const opening = !outlineOpen
    if (outlineBeside) setOutlinePref(opening ? '1' : '0')
    else setOutlineOverlay(opening)
    setOutlineFocus(opening && e.detail === 0)
  }

  const closeOutline = useCallback(() => {
    if (outlineBeside) setOutlinePref('0')
    else setOutlineOverlay(false)
    outlineButton.current?.focus()
  }, [outlineBeside, setOutlinePref])

  function selectOutlineEntry(entry: OutlineEntry, byKeyboard: boolean) {
    if (!outlineBeside) setOutlineOverlay(false)
    const view = cmRef.current?.view() ?? null
    const target = { root: contentRef.current, format, mode: effectiveMode, view, rich: richRef.current }
    revealEntry(target, entry, byKeyboard)
  }

  // Aktive Notiz merken (Konflikte hier nicht automatisch auflösen)
  useEffect(() => {
    sync.activeId = note.id
    sync.setKnownVersion(note.id, note.version)
    return () => {
      if (sync.activeId === note.id) sync.activeId = null
      void sync.flush(note.id)
    }
  }, [note.id, note.version])

  const version = serverNote?.version ?? note.version

  // Verschlüsseln scheitert z. B., wenn der Tresor währenddessen gesperrt wurde
  const vaultFailed = useCallback((err: unknown) => toast.error(errorMessage(err)), [toast])
  const onChange = useCallback(
    (doc: string) => {
      setContent(doc)
      if (inVault) updateVaultNote(note.id, version, { content: doc }).catch(vaultFailed)
      else sync.update(note.id, version, { content: doc, format })
    },
    [note.id, version, format, inVault, vaultFailed],
  )

  // Für Aufrufe von außen (PDF-Viewer, Uploads): immer der aktuelle Stand
  const latest = useRef({ content, format, title, onChange })
  useEffect(() => {
    latest.current = { content, format, title, onChange }
  })
  const editorHandle = (): NoteEditorHandle | null => {
    const f = latest.current.format
    if (f === 'richtext') return richRef.current
    return isVisualFormat(f) ? visualRef.current : cmRef.current
  }

  /** Stand von einem anderen Gerät übernehmen; bei anderem Format wird der Editor neu aufgebaut */
  function applyRemote(remote: Note) {
    // Vergleichsstand fürs nächste Verschlüsseln – sonst ginge eine Rückänderung auf den alten Text verloren
    if (inVault) rememberPlain(remote.id, remote.title, remote.content)
    if (remote.format !== latest.current.format) {
      setFormat(remote.format)
      setContent(remote.content)
    } else if (remote.content !== latest.current.content) {
      editorHandle()?.setDoc(remote.content)
      // Mindmap in der geteilten Ansicht: auch die Gliederung daneben
      if (remote.format === 'mindmap') cmRef.current?.setDoc(remote.content)
      setContent(remote.content)
    }
    if (remote.title !== latest.current.title) setTitle(remote.title)
  }

  // Neuere Version vom Server (z. B. anderes Gerät) übernehmen, wenn lokal nichts offen ist
  useEffect(() => {
    if (!serverNote || serverNote.version <= loadedVersion.current) return
    loadedVersion.current = serverNote.version
    sync.setKnownVersion(serverNote.id, serverNote.version)
    if (sync.getDraft(serverNote.id)) return
    // Abgleich mit externen Systemen (Server-Daten → Editor), daher bewusst im Effect
    applyRemote(serverNote)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverNote?.version])

  // Vom Server automatisch angepasster Titel (z. B. „Titel 1“ bei Namensgleichheit) – im Tresor kennt er ihn nicht
  useEffect(
    () =>
      sync.onSaved((saved) => {
        if (saved.id !== note.id) return
        loadedVersion.current = Math.max(loadedVersion.current, saved.version)
        const d = sync.getDraft(note.id)
        if (!inVault && !d?.title && saved.title !== title && !titleError) setTitle(saved.title)
      }),
    [note.id, title, titleError, inVault],
  )

  const onTitleChange = (value: string) => {
    setTitle(value)
    const err = validateName(value)
    setTitleError(err)
    if (err) return
    if (inVault) updateVaultNote(note.id, version, { title: value.trim() }).catch(vaultFailed)
    else sync.update(note.id, version, { title: value.trim() })
  }

  // Seitenlinks und Zitate aus dem PDF-Viewer an der Cursorposition einfügen – im Lesemodus ans Ende
  useEffect(
    () =>
      registerActiveEditor({
        noteId: note.id,
        get title() {
          return latest.current.title || 'Unbenannt'
        },
        insert: (insertion) => {
          const handle = editorHandle()
          if (handle) return handle.insert(insertion)
          const { content: cur, format: f, onChange: change } = latest.current
          if (f === 'richtext') return change(cur + insertionToHtml(insertion))
          const sep = cur === '' || cur.endsWith('\n\n') ? '' : cur.endsWith('\n') ? '\n' : '\n\n'
          change(cur + sep + insertionToMarkdown(insertion) + '\n')
        },
      }),
    [note.id],
  )

  /** Anhang an der Cursorposition einfügen – im Lesemodus ans Ende */
  const addAttachment = useCallback((att: Attachment) => {
    const handle = editorHandle()
    if (handle) return handle.insertAttachment(att)
    const { content: cur, format: f, onChange: change } = latest.current
    if (f === 'richtext') change(cur + attachmentHtml(att))
    else change(cur + (cur.endsWith('\n') || !cur ? '' : '\n') + attachmentMarkdown(att) + '\n')
  }, [])

  const upload = useCallback(
    async (files: File[]) => {
      if (inVault) return void toast.error(VAULT_UPLOAD_BLOCKED)
      for (const file of files) {
        const name = niceFileName(file)
        try {
          toast.show(`Lade „${name}“ hoch …`)
          const att = await uploadAttachment(file, name)
          addAttachment(att)
          qc.invalidateQueries({ queryKey: attachmentsKey })
          toast.success(`„${att.filename}“ eingefügt.`)
        } catch (err) {
          toast.error(`Upload fehlgeschlagen: ${errorMessage(err)}`)
        }
      }
    },
    [toast, qc, addAttachment, inVault],
  )

  // Tresor-Notizen kennen nur Notizen im Tresor
  const completionData = useMemo(
    () => ({
      titles: () => notes.filter((n) => n.id !== note.id && (inVault || !n.vault)).map((n) => n.title),
      tags: () => tags.map((t) => t.tag),
      files: () => attachments.map((a) => a.filename),
    }),
    [notes, tags, attachments, note.id, inVault],
  )

  const resolveNote = useCallback(
    (target: string) => {
      const n = app.resolveTitle(target, { vault: inVault })
      return n ? { id: n.id, title: n.title } : null
    },
    [app, inVault],
  )

  // Sprung zu einer Überschrift ([[Notiz#Abschnitt]], Abfrage, Glossar): im Editor zur Zeile, sonst zum gerenderten
  // Abschnitt. Editoren und Vorschau sind nicht immer sofort fertig aufgebaut – daher ein paar Versuche.
  useEffect(() => {
    if (!heading) return
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const jump = () => {
      let done = false
      const view = cmRef.current?.view()
      const line = view ? findHeadingLine(view.state.doc.toString(), heading) : null
      if (view && line !== null) {
        revealLine(view, line, false)
        done = true
      }
      const el = headingElement(rootRef.current, heading)
      if (el) {
        el.scrollIntoView({ block: 'start' })
        done = true
      }
      if (!done && ++tries < 20) timer = setTimeout(jump, 50)
    }
    jump()
    return () => clearTimeout(timer)
  }, [heading])

  const isVaultNote = useCallback((id: string) => !!notes.find((n) => n.id === id)?.vault, [notes])
  const previewLinks = useMemo<PreviewLinks>(
    () => ({
      resolveNote,
      onOpenNote: (id, target) => {
        // Überschriften aus dem Tresor nicht in die Adresse (Browserverlauf)
        if (target && isVaultNote(id)) setPendingHeading(id, target)
        app.go({ kind: 'note', id, heading: isVaultNote(id) ? undefined : target })
      },
      isVaultNote,
      // Ein unaufgelöster Link im Tresor legt die neue Notiz im selben Tresor-Ordner an
      onCreateNote: (t) => void app.createNote({ title: t, folderId }).catch((err) => toast.error(errorMessage(err))),
      onOpenTag: (tag) => app.go({ kind: 'tag', tag }),
      onOpenPdf: app.openPdf,
    }),
    [resolveNote, isVaultNote, app, folderId, toast],
  )

  /** Mindmap ändert ihre Gliederung – in der geteilten Ansicht auch den Text daneben */
  const onVisualChange = (doc: string) => {
    onChange(doc)
    if (effectiveMode === 'split') cmRef.current?.replaceDoc(doc)
  }

  const toggleTask = useCallback(
    (line: number, checked: boolean) => {
      const lines = content.split('\n')
      if (line < 0 || line >= lines.length) return
      lines[line] = lines[line].replace(/\[([ xX/\-><!?*])\]/, checked ? '[x]' : '[ ]')
      const next = lines.join('\n')
      cmRef.current?.replaceDoc(next)
      onChange(next)
    },
    [content, onChange],
  )

  /** Karteikarte aus der Markierung (Editor oder Lesemodus) – nicht im Tresor: Karten wären Klartext */
  function createCard() {
    if (inVault) return void toast.error('Karteikarten aus dem Tresor lägen unverschlüsselt im Stapel.')
    const handle = editorHandle()
    const selected = handle ? handle.selectedText() : (document.getSelection()?.toString() ?? '')
    app.openCardEditor({ ...(selected.trim() ? cardFromSelection(selected) : {}), noteId: note.id, deckName: title })
  }

  // PDFs, die in dieser Notiz eingebettet oder verlinkt sind
  const notePdfs = useMemo(
    () =>
      format === 'richtext'
        ? linkedPdfs(content)
        : [...new Set(findWikiLinks(text).map((l) => l.target).filter((t) => /\.pdf$/i.test(t)))],
    [format, content, text],
  )
  const otherPdfs = attachments.filter((a) => a.mime === 'application/pdf' && !notePdfs.includes(a.filename))

  async function uploadPdf(files: File[]) {
    const file = files[0]
    if (!file) return
    if (inVault) return void toast.error(VAULT_UPLOAD_BLOCKED)
    try {
      toast.show(`Lade „${file.name}“ hoch …`)
      const att = await uploadAttachment(file, niceFileName(file))
      qc.invalidateQueries({ queryKey: attachmentsKey })
      // In der Notiz einbetten, damit sie mit dem Skript verknüpft ist (einfacher Text kennt keine Einbettungen)
      if (format !== 'text') addAttachment(att)
      app.openPdf(att.filename)
    } catch (err) {
      toast.error(`Upload fehlgeschlagen: ${errorMessage(err)}`)
    }
  }

  async function copy(kind: 'content' | 'body' | 'link') {
    let ok: boolean
    let message: string
    if (kind === 'link') {
      ok = await copyText(`[[${title}]]`)
      message = 'Wikilink kopiert.'
    } else if (format === 'richtext') {
      ok = await copyHtml(content, htmlToText(content, { codeFences: false }))
      message = 'Mit Formatierung kopiert.'
    } else if (format === 'text') {
      ok = await copyText(content)
      message = 'Text kopiert.'
    } else if (format === 'canvas') {
      ok = await copyText(canvasToMarkdown(parseCanvas(content) ?? { nodes: [], edges: [] }))
      message = 'Inhalt der Karten als Markdown kopiert.'
    } else {
      ok = await copyText(kind === 'body' ? (splitFrontmatter(content)?.body ?? content).replace(/^\n+/, '') : content)
      message = 'Markdown kopiert.'
    }
    if (ok) toast.success(inVault && kind !== 'link' ? `${message} Die Kopie ist unverschlüsselt.` : message)
    else toast.error('Kopieren nicht möglich.')
  }

  /** Dateikarten zeigen im heruntergeladenen Canvas auf die Pfade im Export */
  function canvasDownload(): string {
    const ordered = [...notes].sort((a, b) => a.createdAt - b.createdAt)
    const index = buildExportIndex(
      ordered.map((n) => ({ title: n.title, folders: folderPath(folders, n.folderId).map((f) => f.name), format: n.format })),
      attachments.map((a) => a.filename),
    )
    return canvasForExport(content, index)
  }

  function download() {
    const name = title || 'Notiz'
    const ext = noteExtension(format)
    const body = format === 'richtext' ? htmlDocument(name, content) : format === 'canvas' ? canvasDownload() : content
    const type = { '.html': 'text/html', '.canvas': 'application/json', '.md': 'text/markdown' }[ext]
    const blob = new Blob([body], { type: `${type};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}${ext}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    if (inVault) toast.show('Die heruntergeladene Datei ist unverschlüsselt.')
  }

  async function changeFormat(next: NoteFormat) {
    try {
      const { convertContent } = await import('../client/convert')
      const converted = await convertContent(content, format, next, title || 'Unbenannt')
      setFormat(next)
      setContent(converted)
      if (inVault) await updateVaultNote(note.id, version, { content: converted, format: next }, { immediate: true })
      else sync.update(note.id, version, { content: converted, format: next }, { immediate: true })
      setFormatOpen(false)
      toast.success(`Umgewandelt in „${NOTE_FORMAT_LABELS[next].label}“.`)
    } catch (err) {
      toast.error(`Umwandeln fehlgeschlagen: ${errorMessage(err)}`)
    }
  }

  // Lokaler Graph nur, wenn die Notiz mit anderen verbunden ist (ein- oder ausgehend) – im Tresor gar nicht
  const { data: backlinks = [] } = useBacklinks(mode === 'read' && !inVault ? note.id : null)
  const hasLinks = useMemo(
    () =>
      mode === 'read' &&
      !inVault &&
      (backlinks.length > 0 ||
        extractLinks(text).some((key) => {
          const target = app.resolveTitle(key)
          return !!target && target.id !== note.id
        })),
    [mode, backlinks, text, app, note.id, inVault],
  )

  const { data: flashcards } = useFlashcards()
  const linkedCards = useMemo(() => flashcards?.cards.filter((c) => c.noteId === note.id).length ?? 0, [flashcards, note.id])
  // Im Lesemodus auf Karten in der Notiz hinweisen (Frage::Antwort, Frage-Callouts …)
  const cardsInNote = useMemo(
    () => mode === 'read' && !inVault && parseCardsFromNote(text).some((c) => EXPLICIT_SOURCES.includes(c.source)),
    [mode, text, inVault],
  )

  const path = folderPath(folders, folderId)
  const summaryForActions = summary ?? { ...note, title }
  const copyLabel = {
    markdown: 'Markdown kopieren',
    richtext: 'Kopieren',
    text: 'Text kopieren',
    mindmap: 'Markdown kopieren',
    canvas: 'Als Markdown kopieren',
  }[format]
  // Neue Notiz: Editor fokussieren. Mindmap und Canvas werden nachgeladen und erscheinen oft erst, wenn die Notiz
  // schon gespeichert ist (Version 1) – daher beim Öffnen festhalten und auch dann fokussieren
  const [autoFocus] = useState(
    note.content === '' && (note.version === 0 || (isVisualFormat(note.format) && sync.wasCreatedHere(note.id))),
  )

  const openContextMenu = useContextMenu()
  // Rechtsklick neben das Blatt (Tisch, Kopfzeile, Mindmap und Canvas ohne eigenes Menü): Ansicht und Aktionen
  const modeItems = (
    <>
      {effectiveMode !== 'edit' ? (
        <MenuItem icon={<PenLine />} onSelect={() => setMode('edit')}>
          Bearbeiten
        </MenuItem>
      ) : null}
      {effectiveMode !== 'read' ? (
        <MenuItem icon={<BookOpen />} onSelect={() => setMode('read')}>
          Lesen
        </MenuItem>
      ) : null}
      {canSplit && effectiveMode !== 'split' ? (
        <MenuItem icon={<Columns2 />} onSelect={() => setMode('split')}>
          Geteilt
        </MenuItem>
      ) : null}
      <MenuSeparator />
    </>
  )
  const editorMenu = (e: React.MouseEvent) => {
    const view = cmRef.current?.view()
    const items = view ? <MarkdownEditorMenu view={view} markdown={format !== 'text'} onCreateCard={createCard} /> : null
    openContextMenu(e, items, { text: true })
  }
  const readMenu = (e: React.MouseEvent) =>
    openContextMenu(
      e,
      <ReadViewMenu
        target={e.target as Element}
        links={previewLinks}
        onCreateCard={createCard}
        onEdit={effectiveMode === 'read' ? () => setMode('edit') : undefined}
      />,
      { text: true },
    )

  // Aktionen der Notiz: im Menü „⋮“ und beim Rechtsklick neben das Blatt (auf den Tisch)
  const actionItems = (
    <>
      <MenuItem icon={<Copy />} onSelect={() => copy('content')}>
        {copyLabel}
      </MenuItem>
      {format === 'markdown' || format === 'mindmap' ? (
        <MenuItem icon={<FileText />} onSelect={() => copy('body')}>
          Ohne Properties kopieren
        </MenuItem>
      ) : null}
      <MenuItem icon={<Link2 />} onSelect={() => copy('link')}>
        Als [[Wikilink]] kopieren
      </MenuItem>
      <MenuItem icon={<Download />} onSelect={download}>
        Als {noteExtension(format)} herunterladen
      </MenuItem>
      <MenuItem icon={<Printer />} onSelect={() => setPrintOpen(true)} hint="Strg+P">
        Drucken …
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={summaryForActions.pinned ? <PinOff /> : <Pin />}
        onSelect={() => void app.pinNotes([summaryForActions], !summaryForActions.pinned)}
        disabled={!serverNote}
      >
        {summaryForActions.pinned ? 'Lösen' : 'Anheften'}
      </MenuItem>
      <MenuItem icon={<FolderInput />} onSelect={() => app.openMove({ kind: 'notes', notes: [summaryForActions] })}>
        Verschieben …
      </MenuItem>
      <VaultMoveItem note={summaryForActions} disabled={!serverNote} />
      <MenuItem icon={<Type />} onSelect={() => setFormatOpen(true)} hint={NOTE_FORMAT_LABELS[format].label}>
        Format …
      </MenuItem>
      {sharing && format !== 'canvas' && !inVault ? (
        <MenuItem icon={<Share2 />} onSelect={() => setShareOpen(true)} disabled={!serverNote}>
          Teilen …
        </MenuItem>
      ) : null}
      <MenuItem icon={<History />} onSelect={() => setHistoryOpen(true)} disabled={!serverNote}>
        Verlauf …
      </MenuItem>
      <MenuItem icon={<Info />} onSelect={() => setInfoOpen(true)}>
        Informationen
      </MenuItem>
      {/* Karteikarten und Abfragen lägen im Klartext außerhalb des Tresors */}
      {inVault ? null : (
        <>
          <MenuSeparator />
          <MenuItem icon={<Layers />} onSelect={createCard}>
            Karteikarte erstellen
          </MenuItem>
          <MenuItem icon={<Layers />} onSelect={() => app.openCardsFromNote({ id: note.id, title, content: text })}>
            Karteikarten aus Notiz …
          </MenuItem>
          {canQuiz(format) ? (
            <MenuItem icon={<ListChecks />} onSelect={() => app.go({ kind: 'quiz', id: note.id })}>
              Abfragen
            </MenuItem>
          ) : null}
          {linkedCards > 0 ? (
            <MenuItem
              icon={<GraduationCap />}
              onSelect={() => app.go({ kind: 'study', scope: `note:${note.id}`, mode: 'learn' })}
            >
              {linkedCards} {linkedCards === 1 ? 'Karte' : 'Karten'} lernen
            </MenuItem>
          ) : null}
        </>
      )}
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} danger onSelect={() => void app.trashNotes([{ id: note.id, title }])}>
        In den Papierkorb
      </MenuItem>
    </>
  )

  /** Konflikt mit einem anderen Gerät auflösen – eine Tresor-Notiz erst entschlüsseln, ihre Kopie neu verschlüsseln */
  async function resolveConflict(mode: 'mine' | 'theirs' | 'copy') {
    if (mode === 'mine') return void sync.resolveConflict(note.id, 'mine')
    const server = status.serverNote
    try {
      const remote = server && inVault ? await revealNote(server) : server
      if (mode === 'copy' && inVault) {
        const { content: mine, format: mineFormat, title: mineTitle } = latest.current
        await createVaultNote({
          title: conflictCopyTitle(mineTitle || 'Notiz'),
          folderId: folderId!,
          content: mine,
          format: mineFormat,
        })
      }
      if (remote) applyRemote(remote)
      void sync.resolveConflict(note.id, mode === 'copy' && inVault ? 'theirs' : mode)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  /** Auf einem anderen Gerät gelöscht: eigenen Stand als neue Notiz speichern */
  async function recreate() {
    if (!inVault) return void sync.recreate(note.id, { title, folderId, content, format })
    try {
      const id = await createVaultNote({ title: title || 'Unbenannt', folderId: folderId!, content, format })
      sync.discard(note.id)
      app.go({ kind: 'note', id }, { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const titleInput = (
    <TitleInput value={title} error={titleError} onChange={onTitleChange} onEnter={() => editorHandle()?.focus()} />
  )
  // Über Mindmap und Canvas: kleiner, damit die Fläche Platz hat
  const visualHeader =
    effectiveMode === 'read' ? (
      <h1 className="truncate border-b border-border px-4 py-2.5 text-lg font-bold tracking-tight">{title}</h1>
    ) : effectiveMode === 'edit' ? (
      <TitleInput compact value={title} error={titleError} onChange={onTitleChange} onEnter={() => editorHandle()?.focus()} />
    ) : null
  const visualEditor =
    format === 'mindmap' ? (
      <MindmapEditor
        handleRef={visualRef}
        content={content}
        title={title || 'Unbenannt'}
        onChange={onVisualChange}
        readOnly={effectiveMode === 'read'}
        links={previewLinks}
        onUpload={upload}
        onCreateCard={createCard}
        autoFocus={autoFocus}
        header={visualHeader}
      />
    ) : format === 'canvas' ? (
      <CanvasEditor
        handleRef={visualRef}
        content={content}
        title={title}
        onChange={onChange}
        readOnly={effectiveMode === 'read'}
        links={previewLinks}
        onUpload={upload}
        onCreateCard={createCard}
        header={visualHeader}
        vault={inVault}
      />
    ) : null
  const readView =
    format === 'richtext' ? (
      <RichTextView html={content} onOpenPdf={app.openPdf} />
    ) : format === 'text' ? (
      <PlainTextView text={content} />
    ) : (
      <Preview content={content} {...previewLinks} onToggleTask={toggleTask} />
    )

  return (
    <div
      ref={rootRef}
      className="@container flex h-full flex-col"
      onContextMenu={(e) =>
        openContextMenu(
          e,
          <>
            {modeItems}
            {actionItems}
          </>,
        )
      }
    >
      {/* Kopfzeile */}
      {/* Safe-Area-Abstand außen, Zeilenhöhe innen: sonst überschreibt pt-safe das obere Padding */}
      <header className="pt-safe border-b border-border">
        <div className="flex h-12 items-center gap-1 px-2 sm:px-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => app.go(folderId ? { kind: 'folder', id: folderId } : { kind: 'home' })}
            aria-label="Zurück"
          >
            <ArrowLeft className="size-5" />
          </Button>
          {withOutline ? (
            <Button
              ref={outlineButton}
              variant="ghost"
              size="icon-sm"
              className={cn('mr-1', outlineOpen && 'bg-active text-fg')}
              onClick={toggleOutline}
              title="Gliederung"
              aria-label="Gliederung"
              aria-expanded={outlineOpen}
              aria-controls={outlineId}
            >
              <TableOfContents className="size-4" />
            </Button>
          ) : null}
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-sm text-muted" aria-label="Pfad">
            {path.map((f) => (
              <span key={f.id} className="flex min-w-0 shrink items-center gap-1 @max-2xl:hidden">
                <NavLink to={{ kind: 'folder', id: f.id }} className="truncate hover:text-fg">
                  {f.name}
                </NavLink>
                <ChevronRight className="size-3.5 shrink-0 text-faint" />
              </span>
            ))}
            <span className="truncate font-medium text-fg">{title || 'Unbenannt'}</span>
            {inVault ? (
              <Badge tone="accent" className="ml-1 shrink-0">
                <Lock className="size-3" /> <span className="@max-md:sr-only">Im Tresor</span>
              </Badge>
            ) : null}
          </nav>
          <StatusIndicator status={status} />
          <Menu
            className="max-h-[60vh] w-72 overflow-y-auto"
            trigger={(p) => (
              <Button variant="ghost" size="sm" className="ml-1 px-2" title="PDF daneben öffnen" aria-label="PDF daneben öffnen" {...p}>
                <FileText className="size-4" />
                <span className="@max-2xl:hidden">PDF</span>
              </Button>
            )}
          >
            {notePdfs.length > 0 ? <MenuLabel>In dieser Notiz</MenuLabel> : null}
            {notePdfs.map((f) => (
              <MenuItem key={f} icon={<FileText />} onSelect={() => app.openPdf(f)}>
                <span className="block truncate">{f}</span>
              </MenuItem>
            ))}
            {otherPdfs.length > 0 ? <MenuLabel>{notePdfs.length > 0 ? 'Weitere PDFs' : 'PDFs'}</MenuLabel> : null}
            {otherPdfs.slice(0, 30).map((a) => (
              <MenuItem key={a.id} icon={<FileText />} onSelect={() => app.openPdf(a.filename)}>
                <span className="block truncate">{a.filename}</span>
              </MenuItem>
            ))}
            {notePdfs.length + otherPdfs.length > 0 ? <MenuSeparator /> : null}
            <MenuItem icon={<Upload />} onSelect={() => pdfInput.current?.click()}>
              PDF hochladen und öffnen …
            </MenuItem>
          </Menu>
          <div className="ml-1 flex items-center rounded-lg bg-hover p-0.5" role="radiogroup" aria-label="Ansicht">
            {(
              [
                ['edit', <PenLine key="e" className="size-4" />, 'Bearbeiten'],
                ['read', <BookOpen key="r" className="size-4" />, 'Lesen'],
                ...(canSplit ? [['split', <Columns2 key="s" className="size-4" />, 'Geteilt'] as const] : []),
              ] as const
            ).map(([m, icon, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={effectiveMode === m}
                title={label}
                aria-label={label}
                onClick={() => setMode(m as EditorMode)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
                  effectiveMode === m ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg',
                )}
              >
                {icon}
                <span className="hidden @2xl:inline">{label}</span>
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => copy('content')} className="ml-1 @max-xl:hidden" title={copyLabel}>
            <Copy className="size-4" /> Kopieren
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => copy('content')} className="@max-md:hidden @xl:hidden" aria-label={copyLabel}>
            <Copy className="size-4" />
          </Button>
          <Menu
            trigger={(p) => (
              <Button variant="ghost" size="icon-sm" aria-label="Weitere Aktionen" {...p}>
                <MoreVertical className="size-4" />
              </Button>
            )}
          >
            {actionItems}
          </Menu>
        </div>
      </header>

      {status.state === 'conflict' ? <ConflictBanner status={status} onResolve={resolveConflict} /> : null}
      {status.state === 'error' ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-danger/30 bg-danger-soft px-4 py-2 text-sm text-danger" role="alert">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">{status.error}</span>
          <Button size="sm" onClick={() => void sync.flush(note.id)}>
            Erneut versuchen
          </Button>
          {status.error?.includes('gelöscht') ? (
            <Button size="sm" onClick={() => void recreate()}>
              Als neue Notiz speichern
            </Button>
          ) : null}
        </div>
      ) : null}

      <div ref={contentRef} className="relative flex min-h-0 flex-1">
        {outlineOpen ? (
          <OutlinePanel
            id={outlineId}
            format={format}
            content={content}
            mode={effectiveMode}
            containerRef={contentRef}
            getView={() => cmRef.current?.view() ?? null}
            overlay={!outlineBeside}
            autoFocus={outlineFocus}
            onSelect={selectOutlineEntry}
            onClose={closeOutline}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {format === 'markdown' && effectiveMode !== 'read' ? (
            <div className="border-b border-border">
              <div className="mx-auto max-w-[50rem]">
                <EditorToolbar
                  getView={() => cmRef.current?.view() ?? null}
                  onUpload={upload}
                  onCreateCard={createCard}
                />
              </div>
            </div>
          ) : null}

          <div
            className={cn(
              'min-h-0 flex-1',
              effectiveMode === 'split' ? 'grid grid-cols-2 divide-x divide-border' : 'flex flex-col',
            )}
          >
            {visual && effectiveMode !== 'split' ? (
              visualEditor
            ) : effectiveMode === 'read' ? null : format === 'richtext' ? (
              <RichTextEditor
                handleRef={richRef}
                initialHtml={content}
                onChange={onChange}
                onSave={() => void sync.flush(note.id)}
                onUpload={upload}
                onCreateCard={createCard}
                autoFocus={autoFocus}
                spellcheck={spellcheck === '1' && !inVault}
                slashCommands={slashCommands === '1'}
                header={titleInput}
              />
            ) : (
              <div className="note-desk min-h-0 flex-1 overflow-y-auto">
                <div className="note-paper flex flex-col" onContextMenu={editorMenu}>
                  <div className="mx-auto flex w-full max-w-[44rem] flex-1 flex-col">
                    {titleInput}
                    <div className="min-h-0 flex-1">
                      <Editor
                        key={format}
                        ref={cmRef}
                        initialDoc={content}
                        onChange={onChange}
                        onSave={() => void sync.flush(note.id)}
                        onPasteFiles={upload}
                        data={completionData}
                        autoFocus={autoFocus}
                        spellcheck={spellcheck === '1' && !inVault}
                        plain={format === 'text'}
                        // Nicht in der Gliederung einer Mindmap: Tabellen oder Callouts zerbrächen sie
                        slashCommands={format === 'markdown' && slashCommands === '1'}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
            {visual && effectiveMode === 'split' ? (
              <div className="flex min-h-0 flex-col">{visualEditor}</div>
            ) : !visual && effectiveMode !== 'edit' ? (
              <div className="note-desk min-h-0 flex-1 overflow-y-auto">
                <div className="note-paper" data-mode={effectiveMode} onContextMenu={readMenu}>
                  {effectiveMode === 'read' ? (
                    <h1
                      className="mx-auto max-w-[44rem] px-5 pt-8 pb-3 leading-tight font-bold tracking-tight break-words"
                      style={{ fontSize: 'calc(var(--editor-font-size, 16px) * 1.75)' }}
                    >
                      {title}
                    </h1>
                  ) : (
                    <div className="pt-6" />
                  )}
                  {readView}
                </div>
                {effectiveMode === 'read' ? (
                  // Rund um die Notiz, nicht Teil davon: neben dem Blatt auf dem Tisch
                  <div className="mx-auto w-full max-w-[44rem] space-y-4 px-5 pt-6 pb-16 empty:hidden">
                    {linkedCards > 0 || cardsInNote ? (
                      <NoteCards
                        count={linkedCards}
                        onLearn={(m) => app.go({ kind: 'study', scope: `note:${note.id}`, mode: m })}
                        onCreate={() => app.openCardsFromNote({ id: note.id, title, content: text })}
                      />
                    ) : null}
                    {inVault ? null : <Backlinks id={note.id} />}
                    {hasLinks ? <NoteGraph id={note.id} /> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          void uploadPdf(files)
        }}
      />
      <FormatDialog open={formatOpen} current={format} onClose={() => setFormatOpen(false)} onConfirm={changeFormat} />
      {printOpen ? (
        <NotePrint title={title} format={format} content={content} links={previewLinks} onClose={() => setPrintOpen(false)} />
      ) : null}
      {shareOpen ? <ShareDialog noteId={note.id} title={title} onClose={() => setShareOpen(false)} /> : null}
      <HistoryDialog
        noteId={note.id}
        title={title}
        vault={inVault}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestored={(restored) => {
          loadedVersion.current = restored.version
          applyRemote(restored)
        }}
      />
      <Modal open={infoOpen} onClose={() => setInfoOpen(false)} title="Informationen" size="sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Erstellt</dt>
          <dd>{formatDateTime(note.createdAt)}</dd>
          <dt className="text-muted">Geändert</dt>
          <dd>{formatDateTime(summary?.updatedAt ?? note.updatedAt)}</dd>
          <dt className="text-muted">Format</dt>
          <dd>{NOTE_FORMAT_LABELS[format].label}</dd>
          <dt className="text-muted">Wörter</dt>
          <dd>{wordCount(text).toLocaleString('de-DE')}</dd>
          <dt className="text-muted">Zeichen</dt>
          <dd>{text.length.toLocaleString('de-DE')}</dd>
          <dt className="text-muted">Dateiname</dt>
          <dd className="break-all">{[...path.map((f) => f.name), `${title}${noteExtension(format)}`].join('/')}</dd>
          <dt className="text-muted">Version</dt>
          <dd>{version}</dd>
        </dl>
        {inVault ? null : (
          <div className="mt-4 border-t border-border pt-4">
            <Backlinks id={note.id} compact />
          </div>
        )}
      </Modal>
    </div>
  )
}

/**
 * Gliederung mit Hervorhebung des aktuellen Abschnitts. Berechnet nur, solange sie offen ist, und aus dem verzögerten
 * Stand – so kostet sie beim Tippen fast nichts, und geschlossen gar nichts
 */
function OutlinePanel({
  format,
  content,
  mode,
  containerRef,
  getView,
  onSelect,
  ...props
}: {
  id: string
  format: NoteFormat
  content: string
  mode: EditorMode
  containerRef: React.RefObject<HTMLElement | null>
  getView: () => EditorView | null
  overlay: boolean
  autoFocus: boolean
  onSelect: (entry: OutlineEntry, byKeyboard: boolean) => void
  onClose: () => void
}) {
  const deferredFormat = useDeferredValue(format)
  const deferredContent = useDeferredValue(content)
  const outline = useMemo(() => noteOutline(deferredFormat, deferredContent), [deferredFormat, deferredContent])
  const spy = useOutlineSpy({ containerRef, format, mode, entries: outline.entries, getView })
  return (
    <NoteOutline
      {...props}
      format={format}
      entries={outline.entries}
      truncated={outline.truncated}
      current={spy.current}
      onSelect={(entry, byKeyboard) => {
        spy.pin(outline.entries.indexOf(entry))
        onSelect(entry, byKeyboard)
      }}
    />
  )
}

function TitleInput({
  value,
  error,
  onChange,
  onEnter,
  compact,
}: {
  value: string
  error: string | null
  onChange: (v: string) => void
  onEnter: () => void
  /** Kleine Zeile über Mindmap und Canvas */
  compact?: boolean
}) {
  const errorId = useId()
  return (
    <div className={cn('w-full', compact ? 'border-b border-border px-4 py-1.5' : 'px-5 pt-6 pb-1')}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onEnter()
          }
        }}
        placeholder="Titel"
        aria-label="Titel"
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          'w-full bg-transparent leading-tight font-bold tracking-tight outline-none placeholder:text-faint',
          compact && 'text-lg',
        )}
        style={compact ? undefined : { fontSize: 'calc(var(--editor-font-size, 16px) * 1.75)' }}
        data-testid="note-title"
      />
      {error ? (
        <p id={errorId} className="mt-1 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Lesemodus: Karteikarten aus dieser Notiz */
function NoteCards({ count, onLearn, onCreate }: { count: number; onLearn: (mode: 'learn' | 'practice') => void; onCreate: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
      <Layers className="size-4 text-muted" />
      <span className="flex-1 text-muted">
        {count > 0 ? `${count} ${count === 1 ? 'Karteikarte' : 'Karteikarten'} aus dieser Notiz` : 'Diese Notiz enthält Karteikarten-Fragen'}
      </span>
      {count > 0 ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => onLearn('learn')}>
            <GraduationCap className="size-4" /> Lernen
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onLearn('practice')}>
            <Dumbbell className="size-4" /> Üben
          </Button>
        </>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onCreate}>
        <Layers className="size-4" /> Karten erstellen
      </Button>
    </div>
  )
}

function Backlinks({ id, compact }: { id: string; compact?: boolean }) {
  const { data = [] } = useBacklinks(id)
  if (data.length === 0) {
    return compact ? <p className="text-sm text-muted">Keine anderen Notizen verlinken hierher.</p> : null
  }
  return (
    <div className={cn('rounded-lg border border-border', compact ? 'p-3' : 'p-4')}>
      <h3 className="mb-2 text-sm font-semibold text-muted">
        Verlinkt in {data.length} {data.length === 1 ? 'Notiz' : 'Notizen'}
      </h3>
      <ul className="space-y-1">
        {data.map((b) => (
          <li key={b.id}>
            <NavLink to={{ kind: 'note', id: b.id }} className="text-sm text-accent-text hover:underline">
              {b.title}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Lesemodus: Graph der verlinkten Notizen – zugeklappt, bis man ihn braucht (React Flow wird erst dann geladen) */
function NoteGraph({ id }: { id: string }) {
  const [open, setOpen] = usePref<'1' | '0'>('noted:noteGraph', '0')
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen(open === '1' ? '0' : '1')}
        aria-expanded={open === '1'}
        className="flex w-full items-center gap-1 p-4 text-sm font-semibold text-muted hover:text-fg"
      >
        <ChevronRight className={cn('size-4 transition-transform', open === '1' && 'rotate-90')} />
        Lokaler Graph
      </button>
      {open === '1' ? (
        <div className="animate-fade-in">
          <LocalGraph noteId={id} />
        </div>
      ) : null}
    </div>
  )
}

function ConflictBanner({
  status,
  onResolve,
}: {
  status: NoteSyncStatus
  onResolve: (mode: 'mine' | 'theirs' | 'copy') => void
}) {
  const server = status.serverNote
  return (
    <div className="border-b border-danger/30 bg-danger-soft px-4 py-3 text-sm" role="alert">
      <div className="flex items-start gap-2 text-danger">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>
          <strong>Konflikt:</strong> Diese Notiz wurde{server ? ` ${formatRelative(server.updatedAt)}` : ''} auf einem anderen
          Gerät geändert. Welche Version möchtest du behalten?
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 pl-6">
        <Button size="sm" variant="primary" onClick={() => onResolve('mine')}>
          Meine Version
        </Button>
        <Button size="sm" onClick={() => onResolve('theirs')}>
          Andere Version
        </Button>
        <Button size="sm" onClick={() => onResolve('copy')}>
          Beide behalten
        </Button>
      </div>
    </div>
  )
}
