'use client'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, FileText, Folder as FolderIcon, LayoutTemplate } from 'lucide-react'
import { useApp, type NewNoteOptions } from '@/features/workspace/client/context'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Field, Input, Select } from '@/shared/ui/input'
import { ErrorText, useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { api, errorMessage } from '@/shared/client/api'
import { keys, useFolders, useNotes } from '../client/queries'
import { buildTree, descendantFolderIds, type FolderNode } from '../tree'
import { sync } from '../client/sync'
import { BUILTIN_TEMPLATES, TEMPLATE_FOLDER_NAMES, applyTemplate } from '../templates'
import { validateName } from '@/shared/lib/names'
import { escapeHtml } from '@/shared/lib/html'
import { useDefaultNoteFormat } from '../client/default-format'
import { FormatPicker } from './FormatPicker'
import type { Folder, Note, NoteFormat, NoteSummary } from '../types'

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
