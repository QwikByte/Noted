'use client'
// Dialoge zum Einfügen von Karten: Notiz oder Anhang auswählen, Link eingeben
import { useMemo, useState } from 'react'
import { File as FileIcon, FileText, Image as ImageIcon } from 'lucide-react'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Field, Input } from '@/shared/ui/input'
import { useNotes } from '@/features/notes/client/queries'
import { fuzzyScore } from '@/features/notes/tree'
import { useAttachments } from '@/features/attachments/client/queries'
import type { Attachment } from '@/features/attachments/types'

export type PickedFile = { kind: 'note'; title: string } | { kind: 'attachment'; attachment: Attachment }

/** Notiz oder vorhandenen Anhang als Karte einfügen */
export function FilePicker({
  open,
  excludeTitle,
  onClose,
  onPick,
}: {
  open: boolean
  /** Das Canvas selbst nicht anbieten */
  excludeTitle: string
  onClose: () => void
  onPick: (file: PickedFile) => void
}) {
  const { notes } = useNotes()
  const { data: attachments = [] } = useAttachments()
  const [query, setQuery] = useState('')
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setQuery('')
  }

  const items = useMemo(() => {
    const q = query.trim()
    const score = (text: string, fallback: number) => (q ? fuzzyScore(q, text) : fallback)
    const fromNotes = notes
      .filter((n) => n.title.toLowerCase() !== excludeTitle.toLowerCase())
      .map((n) => ({
        key: `n:${n.id}`,
        label: n.title,
        file: { kind: 'note', title: n.title } as PickedFile,
        score: score(n.title, n.updatedAt),
      }))
    const fromFiles = attachments.map((a) => ({
      key: `a:${a.id}`,
      label: a.filename,
      file: { kind: 'attachment', attachment: a } as PickedFile,
      score: score(a.filename, a.createdAt),
    }))
    return [...fromNotes, ...fromFiles]
      .filter((i) => i.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
  }, [notes, attachments, query, excludeTitle])

  return (
    <Modal open={open} onClose={onClose} title="Notiz oder Datei einfügen" size="md">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Suchen …"
        aria-label="Notiz oder Datei suchen"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && items[0]) {
            e.preventDefault()
            onPick(items[0].file)
          }
        }}
      />
      <ul className="mt-3 max-h-[50vh] space-y-0.5 overflow-y-auto" aria-label="Treffer">
        {items.map((i) => (
          <li key={i.key}>
            <button
              type="button"
              onClick={() => onPick(i.file)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-hover"
            >
              {i.file.kind === 'note' ? (
                <FileText className="size-4 shrink-0 text-muted" />
              ) : i.file.attachment.mime.startsWith('image/') ? (
                <ImageIcon className="size-4 shrink-0 text-muted" />
              ) : (
                <FileIcon className="size-4 shrink-0 text-muted" />
              )}
              <span className="truncate">{i.label}</span>
            </button>
          </li>
        ))}
        {items.length === 0 ? <li className="px-2.5 py-2 text-sm text-muted">Nichts gefunden.</li> : null}
      </ul>
    </Modal>
  )
}

/** Web-Adresse als Karte einfügen */
export function LinkDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (url: string) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const raw = value.trim()
    const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
    try {
      const parsed = new URL(url)
      if (!/^https?:$/.test(parsed.protocol) || !parsed.host) throw new Error()
    } catch {
      return setError('Bitte eine Web-Adresse eingeben, z. B. https://example.org')
    }
    setValue('')
    setError(null)
    onSubmit(url)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link einfügen"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="canvas-link-form">
            Einfügen
          </Button>
        </>
      }
    >
      <form id="canvas-link-form" onSubmit={submit}>
        <Field label="Adresse" error={error}>
          {(id) => (
            <Input
              id={id}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://"
              inputMode="url"
              autoComplete="url"
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}
