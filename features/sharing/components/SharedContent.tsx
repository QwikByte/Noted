'use client'
// Inhalt einer geteilten Notiz – nur im Browser: sanitize() braucht das DOM. Links auf andere Notizen sind reiner Text,
// Dateien kommen über den Link selbst.
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { Preview } from '@/features/notes/components/Preview'
import { PlainTextView, RichTextView } from '@/features/notes/components/ReadView'
import { formatDateTime } from '@/shared/lib/format'
import { rewriteFileUrls, shareFileUrl } from '../links'
import type { SharedNote } from '../types'

const ignore = () => {}
const noNote = () => null
const subscribe = () => () => {}

export function SharedContent({ token, note }: { token: string; note: SharedNote }) {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const fileUrl = useCallback((name: string) => shareFileUrl(token, name), [token])
  const content = useMemo(() => (note.format === 'text' ? note.content : rewriteFileUrls(note.content, token)), [note, token])
  const openFile = useCallback(
    (file: string, page?: number) => window.open(`${shareFileUrl(token, file)}${page ? `#page=${page}` : ''}`, '_blank', 'noopener'),
    [token],
  )
  if (!inBrowser) return null
  return (
    <>
      <p className="mx-5 mt-1 mb-6 border-b border-border pb-5 text-sm text-muted">Stand: {formatDateTime(note.updatedAt)}</p>
      <div data-testid="shared-content">
        {note.format === 'richtext' ? (
          <RichTextView html={content} onOpenPdf={openFile} />
        ) : note.format === 'text' ? (
          <PlainTextView text={note.content} />
        ) : (
          <Preview
            content={content}
            fileUrl={fileUrl}
            plainNoteLinks
            resolveNote={noNote}
            onOpenNote={ignore}
            onCreateNote={ignore}
            onOpenTag={ignore}
            onOpenPdf={openFile}
          />
        )}
      </div>
    </>
  )
}
