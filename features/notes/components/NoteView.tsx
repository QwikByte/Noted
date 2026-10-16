'use client'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
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
  Info,
  Layers,
  Link2,
  Loader2,
  Menu as MenuIcon,
  MoreVertical,
  PenLine,
  Pin,
  PinOff,
  Trash2,
  Type,
  Upload,
} from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { Editor, type EditorHandle } from './Editor'
import { EditorToolbar } from './EditorToolbar'
import { Preview } from './Preview'
import { PlainTextView, RichTextView } from './ReadView'
import { FormatDialog } from './FormatPicker'
import { Button } from '@/shared/ui/button'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/shared/ui/menu'
import { cardFromSelection } from '@/features/flashcards/components/CardEditor'
import { Modal } from '@/shared/ui/modal'
import { useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { useBacklinks, useDrafts, useFolders, useNote, useNotes, useTags } from '../client/queries'
import { attachmentsKey, useAttachments } from '@/features/attachments/client/queries'
import { sync, type NoteSyncStatus } from '../client/sync'
import { usePref, type EditorMode } from '@/shared/client/prefs'
import { copyHtml, copyText } from '@/shared/client/clipboard'
import { folderPath } from '../tree'
import { formatDateTime, formatRelative, wordCount } from '@/shared/lib/format'
import { attachmentMarkdown, niceFileName, uploadAttachment } from '@/features/attachments/client/upload'
import type { Attachment } from '@/features/attachments/types'
import { errorMessage, ApiError } from '@/shared/client/api'
import { useFlashcards } from '@/features/flashcards/client/flashcards'
import { insertionToMarkdown, registerActiveEditor } from '../client/active-editor'
import type { NoteEditorHandle } from '../client/editor-handle'
import { attachmentHtml, insertionToHtml, linkedPdfs } from '../rich-html'
import { NOTE_FORMAT_LABELS, noteExtension, noteText } from '../format'
import { htmlDocument, htmlToText } from '@/shared/lib/html'
import { findWikiLinks, splitFrontmatter } from '@/shared/markdown/meta'
import { EXPLICIT_SOURCES, parseCardsFromNote } from '@/features/flashcards/card-markdown'
import { validateName } from '@/shared/lib/names'
import type { Note, NoteFormat } from '../types'

// Editor für formatierten Text erst laden, wenn er gebraucht wird (TipTap ist groß)
const RichTextEditor = dynamic(() => import('./RichTextEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center text-muted">
      <Loader2 className="size-5 animate-spin" />
    </div>
  ),
})

function useSyncStatus(id: string): NoteSyncStatus {
  return useSyncExternalStore(
    sync.subscribe,
    () => sync.getStatus(id),
    () => sync.getStatus(id),
  )
}

/** Breit genug für Editor und Vorschau nebeneinander? Gemessen am eigenen Bereich (daneben kann ein PDF offen sein). */
function useIsWide(ref: React.RefObject<HTMLElement | null>) {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 960))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
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
    <span className={cn('inline-flex items-center gap-1 text-xs whitespace-nowrap', map.cls)} title={status.error ?? map.label} data-testid="save-status">
      {map.icon}
      <span className="hidden sm:inline">{map.label}</span>
    </span>
  )
}

/** Lädt die Notiz (Server oder lokaler Entwurf) und zeigt dann den Editor. */
export function NoteView({ id, onOpenSidebar }: { id: string; onOpenSidebar: () => void }) {
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
      }
    }
    return null
    // Nur beim ersten Laden relevant – spätere Änderungen verwaltet der Editor selbst
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, isLocalOnly, id])

  if (!base) {
    const notFound = query.error instanceof ApiError && query.error.status === 404
    return (
      <div className="flex h-full flex-col">
        <div className="pt-safe border-b border-border lg:hidden">
          <div className="flex h-12 items-center px-2">
            <Button variant="ghost" size="icon" onClick={onOpenSidebar} aria-label="Menü öffnen">
              <MenuIcon className="size-5" />
            </Button>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center p-8 text-center text-muted">
          {query.isLoading ? (
            <Loader2 className="size-6 animate-spin" />
          ) : (
            <div className="space-y-3">
              <FileText className="mx-auto size-10 text-faint" />
              <p>{notFound ? 'Diese Notiz gibt es nicht (mehr).' : `Die Notiz konnte nicht geladen werden. ${errorMessage(query.error)}`}</p>
              <Button onClick={() => app.go({ kind: 'home' })}>Zur Startseite</Button>
            </div>
          )}
        </div>
      </div>
    )
  }
  return <NoteEditor note={base} serverNote={query.data ?? null} />
}

function NoteEditor({ note, serverNote }: { note: Note; serverNote: Note | null }) {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  // Markdown und einfacher Text: CodeMirror · formatierter Text: TipTap
  const cmRef = useRef<EditorHandle>(null)
  const richRef = useRef<NoteEditorHandle>(null)
  const { notes } = useNotes()
  const { data: folders = [] } = useFolders()
  const { data: tags = [] } = useTags()
  const { data: attachments = [] } = useAttachments()
  const status = useSyncStatus(note.id)
  const rootRef = useRef<HTMLDivElement>(null)
  const isWide = useIsWide(rootRef)
  const pdfInput = useRef<HTMLInputElement>(null)

  const initialDraft = sync.getDraft(note.id)
  const [content, setContent] = useState(initialDraft?.content ?? note.content)
  const [format, setFormat] = useState<NoteFormat>(initialDraft?.format ?? note.format)
  const [title, setTitle] = useState(initialDraft?.title ?? note.title)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [storedMode, setStoredMode] = usePref<EditorMode>('noted:mode', 'edit')
  const [mode, setModeState] = useState<EditorMode>(() => (note.content.trim() === '' ? 'edit' : storedMode))
  const [infoOpen, setInfoOpen] = useState(false)
  const [formatOpen, setFormatOpen] = useState(false)
  const [spellcheck] = usePref<'1' | '0'>('noted:spellcheck', '1')
  const loadedVersion = useRef(note.version)
  const summary = notes.find((n) => n.id === note.id)
  const folderId = summary?.folderId ?? note.folderId
  // Die geteilte Ansicht gibt es nur für Markdown – bei den anderen Formaten sieht der Editor schon aus wie das Ergebnis
  const canSplit = isWide && format === 'markdown'
  const effectiveMode: EditorMode = mode === 'split' && !canSplit ? 'edit' : mode
  const text = useMemo(() => noteText(format, content), [format, content])

  const setMode = (m: EditorMode) => {
    setModeState(m)
    setStoredMode(m)
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

  const onChange = useCallback(
    (doc: string) => {
      setContent(doc)
      sync.update(note.id, version, { content: doc, format })
    },
    [note.id, version, format],
  )

  // Für Aufrufe von außen (PDF-Viewer, Uploads): immer der aktuelle Stand
  const latest = useRef({ content, format, title, onChange })
  useEffect(() => {
    latest.current = { content, format, title, onChange }
  })
  const editorHandle = (): NoteEditorHandle | null =>
    latest.current.format === 'richtext' ? richRef.current : cmRef.current

  /** Stand von einem anderen Gerät übernehmen; bei anderem Format wird der Editor neu aufgebaut */
  function applyRemote(remote: Note) {
    if (remote.format !== latest.current.format) {
      setFormat(remote.format)
      setContent(remote.content)
    } else if (remote.content !== latest.current.content) {
      editorHandle()?.setDoc(remote.content)
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

  // Vom Server automatisch angepasster Titel (z. B. „Titel 1“ bei Namensgleichheit)
  useEffect(
    () =>
      sync.onSaved((saved) => {
        if (saved.id !== note.id) return
        loadedVersion.current = Math.max(loadedVersion.current, saved.version)
        const d = sync.getDraft(note.id)
        if (!d?.title && saved.title !== title && !titleError) setTitle(saved.title)
      }),
    [note.id, title, titleError],
  )

  const onTitleChange = (value: string) => {
    setTitle(value)
    const err = validateName(value)
    setTitleError(err)
    if (!err) sync.update(note.id, version, { title: value.trim() })
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
    [toast, qc, addAttachment],
  )

  const completionData = useMemo(
    () => ({
      titles: () => notes.filter((n) => n.id !== note.id).map((n) => n.title),
      tags: () => tags.map((t) => t.tag),
      files: () => attachments.map((a) => a.filename),
    }),
    [notes, tags, attachments, note.id],
  )

  const resolveNote = useCallback(
    (target: string) => {
      const n = app.resolveTitle(target)
      return n ? { id: n.id, title: n.title } : null
    },
    [app],
  )

  const toggleTask = useCallback(
    (line: number, checked: boolean) => {
      const lines = content.split('\n')
      if (line < 0 || line >= lines.length) return
      lines[line] = lines[line].replace(/\[([ xX/\-><!?*])\]/, checked ? '[x]' : '[ ]')
      const next = lines.join('\n')
      cmRef.current?.setDoc(next)
      onChange(next)
    },
    [content, onChange],
  )

  /** Karteikarte aus der Markierung (Editor oder Lesemodus) */
  function createCard() {
    const handle = editorHandle()
    const selected = handle ? handle.selectedText() : (document.getSelection()?.toString() ?? '')
    app.openCardEditor({ ...(selected.trim() ? cardFromSelection(selected) : {}), noteId: note.id, deckName: title })
  }

  // PDFs, die in dieser Notiz eingebettet oder verlinkt sind
  const notePdfs = useMemo(
    () =>
      format === 'richtext'
        ? linkedPdfs(content)
        : [...new Set(findWikiLinks(content).map((l) => l.target).filter((t) => /\.pdf$/i.test(t)))],
    [format, content],
  )
  const otherPdfs = attachments.filter((a) => a.mime === 'application/pdf' && !notePdfs.includes(a.filename))

  async function uploadPdf(files: File[]) {
    const file = files[0]
    if (!file) return
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
      message = 'Kopiert – mit Formatierung, z. B. zum Einfügen in Word.'
    } else if (format === 'text') {
      ok = await copyText(content)
      message = 'Text kopiert.'
    } else {
      ok = await copyText(kind === 'body' ? (splitFrontmatter(content)?.body ?? content).replace(/^\n+/, '') : content)
      message = 'Markdown kopiert – einfach in Obsidian einfügen.'
    }
    if (ok) toast.success(message)
    else toast.error('Kopieren nicht möglich.')
  }

  function download() {
    const html = format === 'richtext'
    const name = title || 'Notiz'
    const blob = new Blob([html ? htmlDocument(name, content) : content], {
      type: html ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}${noteExtension(format)}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function changeFormat(next: NoteFormat) {
    try {
      const { convertContent } = await import('../client/convert')
      const converted = await convertContent(content, format, next)
      setFormat(next)
      setContent(converted)
      sync.update(note.id, version, { content: converted, format: next }, { immediate: true })
      setFormatOpen(false)
      toast.success(`Umgewandelt in „${NOTE_FORMAT_LABELS[next].label}“.`)
    } catch (err) {
      toast.error(`Umwandeln fehlgeschlagen: ${errorMessage(err)}`)
    }
  }

  const { data: flashcards } = useFlashcards()
  const linkedCards = useMemo(() => flashcards?.cards.filter((c) => c.noteId === note.id).length ?? 0, [flashcards, note.id])
  // Im Lesemodus auf Karten in der Notiz hinweisen (Frage::Antwort, Frage-Callouts …)
  const cardsInNote = useMemo(
    () => mode === 'read' && parseCardsFromNote(text).some((c) => EXPLICIT_SOURCES.includes(c.source)),
    [mode, text],
  )

  const path = folderPath(folders, folderId)
  const summaryForActions = summary ?? { ...note, title }
  const copyLabel = { markdown: 'Markdown kopieren', richtext: 'Kopieren', text: 'Text kopieren' }[format]
  const autoFocus = note.content === '' && note.version === 0

  const titleInput = (
    <TitleInput value={title} error={titleError} onChange={onTitleChange} onEnter={() => editorHandle()?.focus()} />
  )
  const readView =
    format === 'richtext' ? (
      <RichTextView html={content} onOpenPdf={app.openPdf} />
    ) : format === 'text' ? (
      <PlainTextView text={content} />
    ) : (
      <Preview
        content={content}
        resolveNote={resolveNote}
        onOpenNote={(id) => app.go({ kind: 'note', id })}
        onCreateNote={(t) => app.createNote({ title: t, folderId })}
        onOpenTag={(tag) => app.go({ kind: 'tag', tag })}
        onToggleTask={toggleTask}
        onOpenPdf={app.openPdf}
      />
    )

  return (
    <div ref={rootRef} className="@container flex h-full flex-col">
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
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-sm text-muted" aria-label="Pfad">
            {path.map((f) => (
              <span key={f.id} className="flex min-w-0 shrink items-center gap-1 @max-2xl:hidden">
                <button type="button" onClick={() => app.go({ kind: 'folder', id: f.id })} className="truncate hover:text-fg">
                  {f.name}
                </button>
                <ChevronRight className="size-3.5 shrink-0 text-faint" />
              </span>
            ))}
            <span className="truncate font-medium text-fg">{title || 'Unbenannt'}</span>
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
          <Button variant="ghost" size="icon-sm" onClick={() => copy('content')} className="@xl:hidden" aria-label={copyLabel}>
            <Copy className="size-4" />
          </Button>
          <Menu
            trigger={(p) => (
              <Button variant="ghost" size="icon-sm" aria-label="Weitere Aktionen" {...p}>
                <MoreVertical className="size-4" />
              </Button>
            )}
          >
            <MenuItem icon={<Copy />} onSelect={() => copy('content')}>
              {copyLabel}
            </MenuItem>
            {format === 'markdown' ? (
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
            <MenuSeparator />
            <MenuItem icon={summaryForActions.pinned ? <PinOff /> : <Pin />} onSelect={() => app.togglePin(summaryForActions)} disabled={!serverNote}>
              {summaryForActions.pinned ? 'Lösen' : 'Anheften'}
            </MenuItem>
            <MenuItem icon={<FolderInput />} onSelect={() => app.openMove({ kind: 'note', note: summaryForActions })}>
              Verschieben …
            </MenuItem>
            <MenuItem icon={<Type />} onSelect={() => setFormatOpen(true)} hint={NOTE_FORMAT_LABELS[format].label}>
              Format …
            </MenuItem>
            <MenuItem icon={<Info />} onSelect={() => setInfoOpen(true)}>
              Informationen
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Layers />} onSelect={createCard}>
              Karteikarte erstellen
            </MenuItem>
            <MenuItem icon={<Layers />} onSelect={() => app.openCardsFromNote({ id: note.id, title, content: text })}>
              Karteikarten aus Notiz …
            </MenuItem>
            {linkedCards > 0 ? (
              <MenuItem icon={<GraduationCap />} onSelect={() => app.go({ kind: 'study', scope: `note:${note.id}`, mode: 'learn' })}>
                {linkedCards} {linkedCards === 1 ? 'Karte' : 'Karten'} lernen
              </MenuItem>
            ) : null}
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger onSelect={() => app.trashNote({ id: note.id, title })}>
              In den Papierkorb
            </MenuItem>
          </Menu>
        </div>
      </header>

      {status.state === 'conflict' ? <ConflictBanner id={note.id} status={status} onResolved={applyRemote} /> : null}
      {status.state === 'error' ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-danger/30 bg-danger-soft px-4 py-2 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">{status.error}</span>
          <Button size="sm" onClick={() => void sync.flush(note.id)}>
            Erneut versuchen
          </Button>
          {status.error?.includes('gelöscht') ? (
            <Button size="sm" onClick={() => void sync.recreate(note.id, { title, folderId, content, format })}>
              Als neue Notiz speichern
            </Button>
          ) : null}
        </div>
      ) : null}

      {format === 'markdown' && effectiveMode !== 'read' ? (
        <div className="border-b border-border">
          <div className="mx-auto max-w-[50rem]">
            <EditorToolbar getView={() => cmRef.current?.view() ?? null} onUpload={upload} onCreateCard={createCard} />
          </div>
        </div>
      ) : null}

      <div className={cn('min-h-0 flex-1', effectiveMode === 'split' ? 'grid grid-cols-2 divide-x divide-border' : 'flex flex-col')}>
        {effectiveMode === 'read' ? null : format === 'richtext' ? (
          <RichTextEditor
            handleRef={richRef}
            initialHtml={content}
            onChange={onChange}
            onSave={() => void sync.flush(note.id)}
            onUpload={upload}
            onCreateCard={createCard}
            autoFocus={autoFocus}
            spellcheck={spellcheck === '1'}
            header={titleInput}
          />
        ) : (
          <div className="flex min-h-0 flex-col overflow-y-auto">
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
                  spellcheck={spellcheck === '1'}
                  plain={format === 'text'}
                />
              </div>
            </div>
          </div>
        )}
        {effectiveMode !== 'edit' ? (
          <div className="min-h-0 overflow-y-auto">
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
            {effectiveMode === 'read' ? (
              <>
                {linkedCards > 0 || cardsInNote ? (
                  <NoteCards
                    count={linkedCards}
                    onLearn={(m) => app.go({ kind: 'study', scope: `note:${note.id}`, mode: m })}
                    onCreate={() => app.openCardsFromNote({ id: note.id, title, content: text })}
                  />
                ) : null}
                <Backlinks id={note.id} />
              </>
            ) : null}
          </div>
        ) : null}
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
        <div className="mt-4 border-t border-border pt-4">
          <Backlinks id={note.id} compact />
        </div>
      </Modal>
    </div>
  )
}

function TitleInput({
  value,
  error,
  onChange,
  onEnter,
}: {
  value: string
  error: string | null
  onChange: (v: string) => void
  onEnter: () => void
}) {
  return (
    <div className="w-full px-5 pt-6 pb-1">
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
        className="w-full bg-transparent leading-tight font-bold tracking-tight outline-none placeholder:text-faint"
        style={{ fontSize: 'calc(var(--editor-font-size, 16px) * 1.75)' }}
        data-testid="note-title"
      />
      {error ? <p className="mt-1 text-sm text-danger">{error}</p> : null}
    </div>
  )
}

/** Lesemodus: Karteikarten aus dieser Notiz */
function NoteCards({ count, onLearn, onCreate }: { count: number; onLearn: (mode: 'learn' | 'practice') => void; onCreate: () => void }) {
  return (
    <div className="mx-auto max-w-[44rem] px-5 pb-4">
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
    </div>
  )
}

function Backlinks({ id, compact }: { id: string; compact?: boolean }) {
  const app = useApp()
  const { data = [] } = useBacklinks(id)
  if (data.length === 0) {
    return compact ? <p className="text-sm text-muted">Keine anderen Notizen verlinken hierher.</p> : null
  }
  return (
    <div className={cn(compact ? '' : 'mx-auto max-w-[44rem] px-5 pb-16')}>
      <div className={cn('rounded-lg border border-border', compact ? 'p-3' : 'p-4')}>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted">
          <Link2 className="size-4" /> Verlinkt in {data.length} {data.length === 1 ? 'Notiz' : 'Notizen'}
        </h3>
        <ul className="space-y-1">
          {data.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => app.go({ kind: 'note', id: b.id })} className="text-sm text-accent-text hover:underline">
                {b.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function ConflictBanner({
  id,
  status,
  onResolved,
}: {
  id: string
  status: NoteSyncStatus
  /** Version des anderen Geräts in den Editor übernehmen */
  onResolved: (server: Note) => void
}) {
  const server = status.serverNote
  return (
    <div className="border-b border-danger/30 bg-danger-soft px-4 py-3 text-sm">
      <div className="flex items-start gap-2 text-danger">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>
          <strong>Konflikt:</strong> Diese Notiz wurde{server ? ` ${formatRelative(server.updatedAt)}` : ''} auf einem anderen
          Gerät geändert. Welche Version möchtest du behalten?
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 pl-6">
        <Button size="sm" variant="primary" onClick={() => void sync.resolveConflict(id, 'mine')}>
          Meine Version
        </Button>
        <Button
          size="sm"
          onClick={() => {
            if (server) onResolved(server)
            void sync.resolveConflict(id, 'theirs')
          }}
        >
          Andere Version
        </Button>
        <Button
          size="sm"
          onClick={() => {
            if (server) onResolved(server)
            void sync.resolveConflict(id, 'copy')
          }}
        >
          Beide behalten
        </Button>
      </div>
    </div>
  )
}
