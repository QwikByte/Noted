'use client'
import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, FileText, Folder as FolderIcon, History, LayoutTemplate, Loader2, RotateCcw } from 'lucide-react'
import { useApp, type NewNoteOptions } from '@/features/workspace/client/context'
import { ConfirmModal, Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Field, Input, Select } from '@/shared/ui/input'
import { ErrorText, useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { api, errorMessage } from '@/shared/client/api'
import { applySavedNote, keys, useFolders, useNotes, useNoteVersion, useNoteVersions } from '../client/queries'
import { buildTree, descendantFolderIds, type FolderNode } from '../tree'
import { sync } from '../client/sync'
import { BUILTIN_TEMPLATES, TEMPLATE_FOLDER_NAMES, applyTemplate } from '../templates'
import { validateName } from '@/shared/lib/names'
import { escapeHtml } from '@/shared/lib/html'
import { useDefaultNoteFormat } from '../client/default-format'
import { FormatPicker } from './FormatPicker'
import { Preview } from './Preview'
import { PlainTextView, RichTextView } from './ReadView'
import { formatBytes, formatDateTime, formatRelative } from '@/shared/lib/format'
import { NOTE_FORMAT_LABELS } from '../format'
import type { Folder, Note, NoteFormat, NoteSummary, NoteVersion, NoteVersionReason } from '../types'

/** Ordnerliste mit Einrückung für Auswahlfelder. */
function useFolderOptions(exclude?: Set<string>) {
  const { data: folders = [] } = useFolders()
  return useMemo(() => {
    const { roots } = buildTree(folders, [])
    const out: { id: string; label: string; depth: number }[] = []
    const walk = (nodes: FolderNode[]) => {
      for (const n of nodes) {
        if (exclude?.has(n.id)) continue
        out.push({ id: n.id, label: n.name, depth: n.depth })
        walk(n.children)
      }
    }
    walk(roots)
    return out
  }, [folders, exclude])
}

function FolderSelect({
  value,
  onChange,
  exclude,
  id,
}: {
  value: string | null
  onChange: (id: string | null) => void
  exclude?: Set<string>
  id?: string
}) {
  const options = useFolderOptions(exclude)
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— Oberste Ebene —</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {'   '.repeat(o.depth)}
          {o.label}
        </option>
      ))}
    </Select>
  )
}

type TemplateChoice = {
  id: string
  name: string
  description: string
  title: string
  content?: string
  noteId?: string
  /** Format der Vorlage – fehlt nur bei „Leere Notiz“ (passt zu jedem Format) */
  format?: NoteFormat
}

export function NewNoteDialog({ options, onClose }: { options: NewNoteOptions | null; onClose: () => void }) {
  const app = useApp()
  const { notes } = useNotes()
  const { data: folders = [] } = useFolders()
  const [defaultFormat, setDefaultFormat] = useDefaultNoteFormat()
  const [format, setFormat] = useState<NoteFormat>(defaultFormat)
  const [templateId, setTemplateId] = useState('empty')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Eigene Vorlagen: Notizen im Ordner „Vorlagen“ / „Templates“
  const userTemplates: TemplateChoice[] = useMemo(() => {
    const tplFolders = new Set(folders.filter((f) => TEMPLATE_FOLDER_NAMES.includes(f.name.toLowerCase())).map((f) => f.id))
    return notes
      .filter((n) => n.folderId && tplFolders.has(n.folderId))
      .map((n) => ({ id: `user:${n.id}`, noteId: n.id, name: n.title, description: 'Eigene Vorlage', title: '', format: n.format }))
  }, [notes, folders])

  // Die eingebauten Vorlagen sind Markdown; eigene Vorlagen gibt es in jedem Format
  const allTemplates: TemplateChoice[] = useMemo(
    () => [...BUILTIN_TEMPLATES.map((t) => ({ ...t, format: t.id === 'empty' ? undefined : ('markdown' as const) })), ...userTemplates],
    [userTemplates],
  )
  const templates = allTemplates.filter((t) => !t.format || t.format === format)
  const template = templates.find((t) => t.id === templateId) ?? templates[0]

  // Beim Öffnen mit den übergebenen Optionen vorbelegen
  const [prevOptions, setPrevOptions] = useState<NewNoteOptions | null>(null)
  if (options !== prevOptions) {
    setPrevOptions(options)
    if (options) {
      const tpl = allTemplates.find((t) => t.id === options.templateId) ?? allTemplates[0]
      setFormat(tpl.format ?? defaultFormat)
      setTemplateId(tpl.id)
      setTitle(options.title ?? applyTemplate(tpl.title, { title: '' }).trim())
      setTitleTouched(!!options.title)
      setFolderId(options.folderId ?? null)
      setError(null)
    }
  }

  function chooseFormat(next: NoteFormat) {
    setFormat(next)
    if (template.format && template.format !== next) chooseTemplate(allTemplates[0])
  }

  function chooseTemplate(t: TemplateChoice) {
    setTemplateId(t.id)
    if (!titleTouched) setTitle(applyTemplate(t.title, { title: '' }).trim())
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const finalTitle = title.trim() || 'Unbenannt'
    const err = validateName(finalTitle)
    if (err) return setError(err)
    setLoading(true)
    try {
      let content = template.content ?? ''
      if (template.noteId) {
        const res = await api<{ note: Note }>(`/api/notes/${template.noteId}`)
        content = res.note.content
      }
      // Im HTML von formatiertem Text muss der Titel maskiert werden (z. B. „&“)
      const vars = { title: format === 'richtext' ? escapeHtml(finalTitle) : finalTitle }
      await app.createNote({ title: finalTitle, folderId, format, content: applyTemplate(content, vars) })
      setDefaultFormat(format)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={!!options}
      onClose={onClose}
      title="Neue Notiz"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="new-note-form" loading={loading}>
            Erstellen
          </Button>
        </>
      }
    >
      <form id="new-note-form" onSubmit={submit} className="space-y-5">
        <ErrorText>{error}</ErrorText>
        <div>
          <p className="mb-2 text-sm font-medium">Format</p>
          <FormatPicker value={format} onChange={chooseFormat} />
        </div>
        {templates.length > 1 ? (
          <div>
            <p className="mb-2 text-sm font-medium">Vorlage</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => chooseTemplate(t)}
                  className={cn(
                    'relative flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition',
                    t.id === templateId ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {t.noteId ? <LayoutTemplate className="size-3.5 text-accent-text" /> : <FileText className="size-3.5 text-accent-text" />}
                    {t.name}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted">{t.description}</span>
                  {t.id === templateId ? <Check className="absolute top-2 right-2 size-4 text-accent-text" /> : null}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-faint">
              Eigene Vorlagen: Notizen im Ordner „Vorlagen“ – {'{{date}}'}, {'{{time}}'} und {'{{title}}'} werden ersetzt.
            </p>
          </div>
        ) : null}
        <Field label="Titel">
          {(id) => (
            <Input
              id={id}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setTitleTouched(true)
                setError(null)
              }}
              placeholder="Unbenannt"
              autoFocus
            />
          )}
        </Field>
        <Field label="Ordner">{(id) => <FolderSelect id={id} value={folderId} onChange={setFolderId} />}</Field>
      </form>
    </Modal>
  )
}

export function MoveDialog({
  target,
  onClose,
}: {
  target: { kind: 'note'; note: NoteSummary } | { kind: 'folder'; folder: Folder } | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: folders = [] } = useFolders()
  const [dest, setDest] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [prevTarget, setPrevTarget] = useState(target)
  if (target !== prevTarget) {
    setPrevTarget(target)
    if (target) setDest(target.kind === 'note' ? target.note.folderId : target.folder.parentId)
  }

  const exclude = useMemo(
    () => (target?.kind === 'folder' ? descendantFolderIds(folders, target.folder.id) : undefined),
    [target, folders],
  )

  async function submit() {
    if (!target) return
    setLoading(true)
    try {
      if (target.kind === 'note') {
        sync.update(target.note.id, target.note.version, { folderId: dest }, { immediate: true })
      } else {
        await api(`/api/folders/${target.folder.id}`, { method: 'PATCH', body: { parentId: dest } })
        await qc.invalidateQueries({ queryKey: keys.folders })
      }
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const name = target?.kind === 'note' ? target.note.title : target?.folder.name
  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title="Verschieben"
      description={name ? `„${name}“` : undefined}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} loading={loading}>
            Verschieben
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <FolderIcon className="size-4 text-accent-text" />
        <div className="flex-1">
          <FolderSelect value={dest} onChange={setDest} exclude={exclude} />
        </div>
      </div>
    </Modal>
  )
}

export function PromptDialog({
  open,
  title,
  label,
  initialValue,
  confirmLabel,
  validate,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  validate?: (v: string) => string | null
  onClose: () => void
  onSubmit: (value: string) => Promise<void>
}) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [prevOpen, setPrevOpen] = useState(false)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setValue(initialValue)
      setError(null)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = value.trim()
    const err = validate?.(v) ?? null
    if (err) return setError(err)
    setLoading(true)
    try {
      await onSubmit(v)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="prompt-form" loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id="prompt-form" onSubmit={submit}>
        <Field label={label} error={error}>
          {(id) => (
            <Input
              id={id}
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setError(null)
              }}
              autoFocus
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}

const REASON_LABELS: Record<NoteVersionReason, string> = {
  edit: 'Automatisch gesichert',
  format: 'Vor dem Formatwechsel',
  conflict: 'Vor dem Überschreiben (Konflikt)',
  restore: 'Vor dem Wiederherstellen',
}

const ignore = () => {}

/** Verlauf einer Notiz: ältere Stände ansehen und wiederherstellen */
export function HistoryDialog({
  noteId,
  title,
  open,
  onClose,
  onRestored,
}: {
  noteId: string
  /** Aktueller Titel – ältere Stände mit anderem Titel zeigen ihren Titel an */
  title: string
  open: boolean
  onClose: () => void
  /** Wiederhergestellten Stand in den Editor übernehmen */
  onRestored: (note: Note) => void
}) {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const list = useNoteVersions(noteId, open)
  const versions = list.data ?? []
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setSelectedId(null)
  }

  const selected = versions.find((v) => v.id === selectedId) ?? versions[0] ?? null
  const detail = useNoteVersion(noteId, open && selected ? selected.id : null)
  const resolveNote = useCallback(
    (target: string) => {
      const n = app.resolveTitle(target)
      return n ? { id: n.id, title: n.title } : null
    },
    [app],
  )

  async function restore() {
    if (!selected) return
    setRestoring(true)
    try {
      // Offene Änderungen zuerst speichern – so landen auch sie im Verlauf, bevor der alte Stand sie ersetzt
      if (sync.getDraft(noteId)) await sync.flush(noteId)
      const res = await api<{ note: Note; linksUpdated: number }>(
        `/api/notes/${noteId}/versions/${selected.id}/restore`,
        { method: 'POST' },
      )
      sync.discard(noteId)
      sync.setKnownVersion(noteId, res.note.version)
      onRestored(res.note)
      applySavedNote(qc, res.note)
      void qc.invalidateQueries({ queryKey: keys.versions(noteId) })
      void qc.invalidateQueries({ queryKey: keys.tags })
      if (res.linksUpdated > 0) {
        void qc.invalidateQueries({ queryKey: keys.notes })
        void qc.invalidateQueries({ queryKey: ['note'] })
      }
      toast.success(`Stand vom ${formatDateTime(selected.createdAt)} wiederhergestellt.`)
      setConfirming(false)
      onClose()
    } catch (err) {
      toast.error(`Wiederherstellen fehlgeschlagen: ${errorMessage(err)}`)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Verlauf"
      description="Ältere Stände der Notiz – gesichert beim Weiterschreiben (höchstens alle 10 Minuten) und vor Formatwechsel, Konflikt oder Wiederherstellen."
      size="xl"
    >
      {list.isLoading ? (
        <Loader2 className="mx-auto my-8 size-6 animate-spin text-faint" />
      ) : list.error ? (
        <ErrorText>Der Verlauf konnte nicht geladen werden. {errorMessage(list.error)}</ErrorText>
      ) : versions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-muted">
          <History className="mx-auto mb-2 size-8 text-faint" />
          Noch keine älteren Stände.
        </div>
      ) : (
        <div className="grid gap-4 md:h-[min(60vh,36rem)] md:grid-cols-[16rem_1fr]">
          <ul
            className="max-h-48 space-y-1 overflow-y-auto md:max-h-none"
            aria-label="Gesicherte Stände"
            data-testid="history-list"
          >
            {versions.map((v) => (
              <li key={v.id}>
                <VersionItem version={v} title={title} active={v.id === selected?.id} onSelect={() => setSelectedId(v.id)} />
              </li>
            ))}
          </ul>
          <div className="flex min-h-0 flex-col rounded-xl border border-border">
            {selected ? (
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{selected.title}</p>
                  <p className="text-xs text-faint">
                    {formatDateTime(selected.createdAt)} · {NOTE_FORMAT_LABELS[selected.format].label}
                  </p>
                </div>
                <Button size="sm" variant="primary" onClick={() => setConfirming(true)} disabled={!detail.data}>
                  <RotateCcw className="size-4" /> Diesen Stand wiederherstellen
                </Button>
              </div>
            ) : null}
            <div className="history-preview min-h-48 flex-1 overflow-y-auto p-3" data-testid="history-preview">
              {detail.isLoading ? (
                <Loader2 className="mx-auto my-8 size-5 animate-spin text-faint" />
              ) : detail.error ? (
                <ErrorText>{errorMessage(detail.error)}</ErrorText>
              ) : detail.data ? (
                detail.data.format === 'markdown' || detail.data.format === 'mindmap' ? (
                  <Preview
                    content={detail.data.content}
                    resolveNote={resolveNote}
                    onOpenNote={ignore}
                    onCreateNote={ignore}
                    onOpenTag={ignore}
                  />
                ) : detail.data.format === 'richtext' ? (
                  <RichTextView html={detail.data.content} onOpenPdf={ignore} />
                ) : (
                  <PlainTextView text={detail.data.content} />
                )
              ) : null}
            </div>
          </div>
        </div>
      )}
      <ConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void restore()}
        loading={restoring}
        title="Diesen Stand wiederherstellen?"
        description={
          selected
            ? `Titel, Format und Inhalt werden auf den Stand vom ${formatDateTime(selected.createdAt)} zurückgesetzt. Der jetzige Stand bleibt im Verlauf erhalten.`
            : undefined
        }
        confirmLabel="Wiederherstellen"
      />
    </Modal>
  )
}

function VersionItem({
  version,
  title,
  active,
  onSelect,
}: {
  version: NoteVersion
  title: string
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'w-full rounded-lg px-3 py-2 text-left transition-colors',
        active ? 'bg-active' : 'hover:bg-hover',
      )}
    >
      <span className="block text-sm font-medium" title={formatDateTime(version.createdAt)}>
        {formatRelative(version.createdAt)}
      </span>
      <span className="block text-xs text-muted">
        {REASON_LABELS[version.reason]} · {formatBytes(version.size)}
      </span>
      {version.title !== title ? <span className="block truncate text-xs text-faint">„{version.title}“</span> : null}
    </button>
  )
}
