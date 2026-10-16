'use client'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BookOpenText, Copy, Download, ExternalLink, File, FileAudio, FileText, FileVideo, Loader2, Paperclip, Trash2, Upload } from 'lucide-react'
import { Page, PageHeader } from './views'
import { useApp } from './context'
import { Button } from '../ui/button'
import { ConfirmModal } from '../ui/modal'
import { useToast } from '../ui/toast'
import { api, errorMessage } from '@/lib/client/api'
import { keys, useAttachments } from '@/lib/client/queries'
import { formatBytes, formatRelative } from '@/lib/client/format'
import { copyText } from '@/lib/client/clipboard'
import { attachmentMarkdown, niceFileName, uploadAttachment } from '@/lib/client/upload'
import type { Attachment } from '@/lib/shared/types'

function FileIcon({ mime }: { mime: string }) {
  if (mime.startsWith('audio/')) return <FileAudio className="size-6" />
  if (mime.startsWith('video/')) return <FileVideo className="size-6" />
  if (mime === 'application/pdf' || mime.startsWith('text/')) return <FileText className="size-6" />
  return <File className="size-6" />
}

export function FilesView() {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const { data: files = [], isLoading } = useAttachments()
  const [uploading, setUploading] = useState(false)
  const [toDelete, setToDelete] = useState<Attachment | null>(null)

  async function upload(list: File[]) {
    setUploading(true)
    for (const f of list) {
      try {
        const att = await uploadAttachment(f, niceFileName(f))
        toast.success(`„${att.filename}“ hochgeladen.`)
      } catch (err) {
        toast.error(`${f.name}: ${errorMessage(err)}`)
      }
    }
    setUploading(false)
    qc.invalidateQueries({ queryKey: keys.attachments })
  }

  const total = files.reduce((s, f) => s + f.size, 0)

  return (
    <Page>
      <PageHeader
        icon={<Paperclip />}
        title="Anhänge"
        subtitle={`${files.length} ${files.length === 1 ? 'Datei' : 'Dateien'} · ${formatBytes(total)}`}
        actions={
          <Button variant="primary" size="sm" onClick={() => input.current?.click()} loading={uploading}>
            <Upload className="size-4" /> Hochladen
          </Button>
        }
      />
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const list = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (list.length) void upload(list)
        }}
      />
      <p className="mb-4 text-sm text-muted">
        Einbetten mit <code className="rounded bg-subtle px-1.5 py-0.5 text-[13px]">![[Dateiname]]</code>. Beim Export landen alle
        Dateien im Ordner „Anhänge“ – Obsidian findet sie dort automatisch.
      </p>
      {isLoading ? (
        <Loader2 className="mx-auto size-6 animate-spin text-faint" />
      ) : files.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center text-muted"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void upload(Array.from(e.dataTransfer.files))
          }}
        >
          Noch keine Anhänge. Dateien hierher ziehen oder im Editor über die Büroklammer einfügen.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {files.map((f) => {
            const url = `/api/attachments/${f.id}`
            return (
              <div key={f.id} className="group overflow-hidden rounded-xl border border-border bg-elevated">
                {f.mime === 'application/pdf' ? (
                  // PDFs im eingebauten Viewer (neben der aktuellen Ansicht) statt in einem neuen Tab
                  <button
                    type="button"
                    onClick={() => app.openPdf(f.filename)}
                    className="flex aspect-[4/3] w-full items-center justify-center bg-subtle text-faint hover:text-muted"
                    aria-label={`${f.filename} öffnen`}
                  >
                    <FileIcon mime={f.mime} />
                  </button>
                ) : (
                  <a href={url} target="_blank" rel="noopener" className="flex aspect-[4/3] items-center justify-center bg-subtle text-faint">
                    {f.mime.startsWith('image/') && f.mime !== 'image/heic' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={f.filename} loading="lazy" className="size-full object-cover" />
                    ) : (
                      <FileIcon mime={f.mime} />
                    )}
                  </a>
                )}
                <div className="p-2.5">
                  <p className="truncate text-sm font-medium" title={f.filename}>
                    {f.filename}
                  </p>
                  <p className="text-xs text-faint">
                    {formatBytes(f.size)} · {formatRelative(f.createdAt)}
                  </p>
                  <div className="mt-1.5 flex gap-0.5">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="Einbettung kopieren"
                      aria-label="Einbettung kopieren"
                      onClick={async () => {
                        await copyText(attachmentMarkdown(f))
                        toast.success('In die Zwischenablage kopiert.')
                      }}
                    >
                      <Copy className="size-4" />
                    </Button>
                    {f.mime === 'application/pdf' ? (
                      <Button size="icon-sm" variant="ghost" title="Im PDF-Viewer öffnen" aria-label="Im PDF-Viewer öffnen" onClick={() => app.openPdf(f.filename)}>
                        <BookOpenText className="size-4" />
                      </Button>
                    ) : (
                      <a href={url} target="_blank" rel="noopener" title="Öffnen" aria-label="Öffnen" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-fg">
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                    <a href={`${url}?download=1`} title="Herunterladen" aria-label="Herunterladen" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-fg">
                      <Download className="size-4" />
                    </a>
                    <Button size="icon-sm" variant="ghost" title="Löschen" aria-label="Löschen" onClick={() => setToDelete(f)} className="ml-auto">
                      <Trash2 className="size-4 text-danger" />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Datei löschen?"
        description={toDelete ? `„${toDelete.filename}“ wird endgültig gelöscht. Einbettungen in Notizen funktionieren danach nicht mehr.` : undefined}
        confirmLabel="Löschen"
        danger
        onConfirm={async () => {
          if (!toDelete) return
          try {
            await api(`/api/attachments/${toDelete.id}`, { method: 'DELETE' })
            await qc.invalidateQueries({ queryKey: keys.attachments })
          } catch (err) {
            toast.error(errorMessage(err))
          }
          setToDelete(null)
        }}
      />
    </Page>
  )
}
