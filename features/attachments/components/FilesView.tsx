'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  BookOpenText,
  ChevronRight,
  CloudDownload,
  CloudOff,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder as FolderIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Unlink,
  Upload,
} from 'lucide-react'
import { Page, PageHeader } from '@/shared/ui/page-layout'
import { useApp } from '@/features/workspace/client/context'
import { useFolders, useNotes } from '@/features/notes/client/queries'
import { folderPath } from '@/features/notes/tree'
import { Button } from '@/shared/ui/button'
import { MenuItem, MenuSeparator, useContextMenu } from '@/shared/ui/menu'
import { ConfirmModal } from '@/shared/ui/modal'
import { useToast } from '@/shared/ui/toast'
import { api, errorMessage } from '@/shared/client/api'
import { attachmentsKey, useFiles } from '../client/queries'
import { formatBytes, formatRelative } from '@/shared/lib/format'
import { copyText } from '@/shared/client/clipboard'
import { attachmentMarkdown, niceFileName, uploadAttachment } from '../client/upload'
import { prunePdfPreviews } from '../client/preview'
import { makePdfOffline, pruneOfflineFiles, unpinPdf, useOfflineUsage, usePinnedPdfs } from '@/features/pdf/client/offline'
import { filesAt, UNLINKED, type FileItem } from '../folders'
import type { FileEntry, SearchIndexInfo } from '../types'
import { FilePreview } from './FilePreview'

const filesLabel = (n: number) => `${n} ${n === 1 ? 'Datei' : 'Dateien'}`

function deleteDescription(file: FileEntry) {
  const n = file.noteIds.length
  const embeds = n ? ` Einbettungen in ${n === 1 ? 'einer Notiz' : `${n} Notizen`} funktionieren danach nicht mehr.` : ''
  return `„${file.filename}“ wird endgültig gelöscht.${embeds}`
}

/**
 * Dateien in der Ordnerstruktur der Notizen: Jede Datei steht im Ordner der Notiz, die sie einbettet. Ordner werden
 * hier weder angelegt noch verschoben – das geschieht mit den Notizen.
 */
export function FilesView({ folder: level }: { folder?: string }) {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const { data: files = [], isLoading, isSuccess, isFetchedAfterMount } = useFiles()
  const { notes } = useNotes()
  const { data: folders = [], isLoading: foldersLoading } = useFolders()
  const [uploading, setUploading] = useState(false)
  const [toDelete, setToDelete] = useState<FileEntry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const openContextMenu = useContextMenu()

  const unlinked = level === UNLINKED
  const folder = level && !unlinked ? folders.find((f) => f.id === level) : undefined
  const content = useMemo(() => filesAt(files, notes, folders, level ?? null), [files, notes, folders, level])
  const path = folder ? folderPath(folders, folder.id) : []

  // Offline-Speicher aufräumen: Vorschauen, Dateien, die es nicht mehr gibt, und PDFs über dem Budget – Letzteres erst
  // mit der frisch geladenen Liste (die zwischengespeicherte kennt neue Dateien womöglich noch nicht)
  const [pruned, setPruned] = useState(0)
  useEffect(() => {
    if (!isSuccess) return
    const offline = isFetchedAfterMount ? pruneOfflineFiles(files) : null
    void Promise.all([prunePdfPreviews(files.map((f) => f.id)), offline]).then(() => setPruned((n) => n + 1))
  }, [isSuccess, isFetchedAfterMount, files])
  const usage = useOfflineUsage(pruned)

  async function upload(list: File[]) {
    setUploading(true)
    for (const f of list) {
      try {
        const att = await uploadAttachment(f, niceFileName(f))
        toast.success(
          unlinked
            ? `„${att.filename}“ hochgeladen.`
            : `„${att.filename}“ hochgeladen – sie steht unter „Ohne Notiz“, bis eine Notiz sie einbettet.`,
        )
      } catch (err) {
        toast.error(`${f.name}: ${errorMessage(err)}`)
      }
    }
    setUploading(false)
    qc.invalidateQueries({ queryKey: attachmentsKey })
  }

  /** Text für die Volltextsuche erneut auslesen (z. B. nach einem Fehler) */
  async function reindex(file: FileEntry) {
    toast.show(`Lese „${file.filename}“ …`)
    try {
      const { search } = await api<{ search: SearchIndexInfo }>(`/api/attachments/${file.id}/index`, { method: 'POST' })
      await qc.invalidateQueries({ queryKey: attachmentsKey })
      if (search.state === 'done') toast.success(`„${file.filename}“ ist durchsuchbar.`)
      else toast.error(`„${file.filename}“: ${searchLabel(search)}`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (level && !unlinked && !folder) {
    return (
      <Page>
        {foldersLoading ? (
          <Loader2 className="mx-auto size-6 animate-spin text-faint" />
        ) : (
          <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
            <p className="font-semibold">Ordner nicht gefunden</p>
            <Button className="mt-5" onClick={() => app.go({ kind: 'files' })}>
              Alle Dateien
            </Button>
          </div>
        )}
      </Page>
    )
  }

  const total = files.reduce((s, f) => s + f.size, 0)
  const subtitle = !level
    ? `${filesLabel(files.length)} · ${formatBytes(total)}${usage ? ` · offline gespeichert: ${formatBytes(usage)}` : ''}`
    : `${filesLabel(content.files.length)}${content.folders.length ? ` · ${content.folders.length} Unterordner` : ''}`
  const empty = content.folders.length === 0 && content.files.length === 0 && (level || content.unlinked === 0)

  return (
    <Page
      onContextMenu={(e) =>
        openContextMenu(
          e,
          <MenuItem icon={<Upload />} onSelect={() => input.current?.click()} disabled={uploading}>
            Hochladen …
          </MenuItem>,
          { text: true, copy: true },
        )
      }
    >
      <PageHeader
        title={folder ? folder.name : unlinked ? 'Ohne Notiz' : 'Dateien'}
        subtitle={subtitle}
        breadcrumb={
          level ? (
            <nav className="mb-2 flex flex-wrap items-center gap-1 text-sm text-muted" aria-label="Ordnerpfad">
              {[{ id: undefined, name: 'Dateien' }, ...path.slice(0, -1)].map((f) => (
                <span key={f.id ?? 'root'} className="flex items-center gap-1">
                  <button type="button" className="hover:text-fg" onClick={() => app.go({ kind: 'files', folder: f.id })}>
                    {f.name}
                  </button>
                  <ChevronRight className="size-3.5" />
                </span>
              ))}
            </nav>
          ) : null
        }
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
      {content.folders.length > 0 || (!level && content.unlinked > 0) ? (
        <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {content.folders.map(({ folder: f, count }) => (
            <FolderTile
              key={f.id}
              icon={<FolderIcon />}
              name={f.name}
              count={count}
              onClick={() => app.go({ kind: 'files', folder: f.id })}
            />
          ))}
          {!level && content.unlinked > 0 ? (
            <FolderTile
              icon={<Unlink />}
              name="Ohne Notiz"
              count={content.unlinked}
              onClick={() => app.go({ kind: 'files', folder: UNLINKED })}
            />
          ) : null}
        </div>
      ) : null}

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
          Noch keine Dateien. Dateien hierher ziehen.
        </div>
      ) : empty ? (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center text-muted">
          {unlinked
            ? 'Alle Dateien kommen in Notizen vor.'
            : 'Hier liegen keine Dateien. Sie erscheinen, sobald eine Notiz in diesem Ordner sie einbettet.'}
        </div>
      ) : content.files.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {content.files.map((item) => (
            <FileCard
              key={item.file.id}
              item={item}
              onDelete={() => setToDelete(item.file)}
              onReindex={() => void reindex(item.file)}
            />
          ))}
        </div>
      ) : null}
      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Datei löschen?"
        description={toDelete ? deleteDescription(toDelete) : undefined}
        confirmLabel="Löschen"
        danger
        loading={deleting}
        onConfirm={async () => {
          if (!toDelete) return
          setDeleting(true)
          try {
            await api(`/api/attachments/${toDelete.id}`, { method: 'DELETE' })
            await qc.invalidateQueries({ queryKey: attachmentsKey })
          } catch (err) {
            toast.error(errorMessage(err))
          } finally {
            setDeleting(false)
          }
          setToDelete(null)
        }}
      />
    </Page>
  )
}

type FolderTileProps = { icon: React.ReactNode; name: string; count: number; onClick: () => void }

function FolderTile({ icon, name, count, onClick }: FolderTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg border border-border bg-elevated px-4 py-3 text-left text-sm font-medium transition-colors hover:border-border-strong hover:bg-subtle"
    >
      <span className="text-muted [&>svg]:size-4">{icon}</span>
      <span className="truncate">{name}</span>
      <span className="ml-auto text-xs text-faint">{count}</span>
    </button>
  )
}

/** Ob die Volltextsuche die Datei findet – nur bei PDFs und Textdateien */
function searchLabel(search: SearchIndexInfo): string {
  switch (search.state) {
    case 'done':
      return search.reason ? `durchsuchbar (${search.reason})` : 'durchsuchbar'
    case 'pending':
      return 'wird für die Suche gelesen …'
    case 'skipped':
      return `nicht indiziert: ${search.reason ?? 'unbekannt'}`
    case 'failed':
      return 'nicht indiziert: Fehler beim Lesen'
  }
}

function FileCard({ item, onDelete, onReindex }: { item: FileItem; onDelete: () => void; onReindex: () => void }) {
  const app = useApp()
  const toast = useToast()
  const openContextMenu = useContextMenu()
  const { file: f, notes } = item
  const url = `/api/attachments/${f.id}`
  const pdf = f.mime === 'application/pdf'
  const offline = usePinnedPdfs().has(f.filename.toLowerCase())

  /** „Offline verfügbar“: in den Offline-Speicher laden und dort halten – oder die Markierung aufheben */
  async function toggleOffline() {
    if (offline) {
      unpinPdf(f.filename)
      toast.show(`„${f.filename}“ wird nicht mehr offline gehalten.`)
      return
    }
    try {
      await makePdfOffline(f.filename)
      toast.success(`„${f.filename}“ ist offline verfügbar.`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function copyEmbed() {
    if (await copyText(attachmentMarkdown(f))) toast.success('In die Zwischenablage kopiert.')
    else toast.error('Kopieren nicht möglich.')
  }

  return (
    <div
      className="group overflow-hidden rounded-xl border border-border bg-elevated"
      data-testid="file-card"
      onContextMenu={(e) =>
        openContextMenu(
          e,
          <>
            {f.mime === 'application/pdf' ? (
              <MenuItem icon={<BookOpenText />} onSelect={() => app.openPdf(f.filename)}>
                Im PDF-Viewer öffnen
              </MenuItem>
            ) : (
              // Wie der Link an der Datei: in einem neuen Tab
              <MenuItem icon={<ExternalLink />} onSelect={() => window.open(url, '_blank', 'noopener')}>
                Öffnen
              </MenuItem>
            )}
            <MenuItem icon={<Download />} onSelect={() => window.location.assign(`${url}?download=1`)}>
              Herunterladen
            </MenuItem>
            <MenuItem icon={<Copy />} onSelect={() => void copyEmbed()}>
              Einbettung kopieren
            </MenuItem>
            {notes.length > 0 ? (
              <MenuItem icon={<FileText />} onSelect={() => app.go({ kind: 'note', id: notes[0].id })}>
                Zur Notiz
              </MenuItem>
            ) : null}
            {pdf ? (
              <MenuItem icon={offline ? <CloudOff /> : <CloudDownload />} onSelect={() => void toggleOffline()}>
                {offline ? 'Nicht mehr offline halten' : 'Offline verfügbar machen'}
              </MenuItem>
            ) : null}
            {f.search && f.search.state !== 'pending' ? (
              <MenuItem icon={<RefreshCw />} onSelect={onReindex}>
                Erneut indizieren
              </MenuItem>
            ) : null}
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger onSelect={onDelete}>
              Löschen …
            </MenuItem>
          </>,
          { copy: true },
        )
      }
    >
      {f.mime === 'application/pdf' ? (
        // PDFs im eingebauten Viewer (neben der aktuellen Ansicht) statt in einem neuen Tab
        <button
          type="button"
          onClick={() => app.openPdf(f.filename)}
          className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden border-b border-border bg-subtle text-faint hover:text-muted"
          aria-label={`${f.filename} öffnen`}
        >
          <FilePreview file={f} />
        </button>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener"
          className="flex aspect-[4/3] items-center justify-center overflow-hidden border-b border-border bg-subtle text-faint"
          aria-label={`${f.filename} öffnen`}
        >
          <FilePreview file={f} />
        </a>
      )}
      <div className="p-2.5">
        <p className="truncate text-sm font-medium" title={f.filename}>
          {f.filename}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-faint">
          {formatBytes(f.size)} · {formatRelative(f.createdAt)}
          {offline ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-accent-soft px-1.5 font-medium text-accent-text" data-testid="file-offline">
              <CloudDownload className="size-3" /> offline
            </span>
          ) : null}
        </p>
        {f.search ? (
          <p className="truncate text-xs text-faint" title={searchLabel(f.search)} data-testid="file-search-state">
            {searchLabel(f.search)}
          </p>
        ) : null}
        {notes.length > 0 ? (
          <button
            type="button"
            onClick={() => app.go({ kind: 'note', id: notes[0].id })}
            className="mt-1 flex max-w-full items-center gap-1 text-xs text-muted hover:text-accent-text"
            title={notes.map((n) => n.title).join(', ')}
          >
            <FileText className="size-3 shrink-0" />
            <span className="truncate">{notes[0].title}</span>
            {notes.length > 1 ? <span className="shrink-0 text-faint">+{notes.length - 1}</span> : null}
          </button>
        ) : null}
        <div className="mt-1.5 flex gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            title="Einbettung kopieren"
            aria-label="Einbettung kopieren"
            onClick={() => void copyEmbed()}
          >
            <Copy className="size-4" />
          </Button>
          {pdf ? (
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
          {f.search && f.search.state !== 'pending' ? (
            <Button size="icon-sm" variant="ghost" title="Erneut indizieren" aria-label="Erneut indizieren" onClick={onReindex}>
              <RefreshCw className="size-4" />
            </Button>
          ) : null}
          <Button size="icon-sm" variant="ghost" title="Löschen" aria-label="Löschen" onClick={onDelete} className="ml-auto">
            <Trash2 className="size-4 text-danger" />
          </Button>
        </div>
      </div>
    </div>
  )
}
