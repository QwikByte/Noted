'use client'
// Konflikt: beide Fassungen vergleichen, bevor eine gewählt wird – im Tresor erst nach dem Entschlüsseln im Browser
import { Loader2 } from 'lucide-react'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { ErrorText } from '@/shared/ui/toast'
import { formatRelative } from '@/shared/lib/format'
import { useDecrypted } from '@/features/vault/client/vault'
import { VaultError } from '@/features/vault/crypto'
import { noteText } from '../format'
import { DiffView } from './DiffView'
import type { Note, NoteFormat } from '../types'

export function ConflictDialog({
  open,
  server,
  mine,
  vault,
  onClose,
  onResolve,
}: {
  open: boolean
  /** Stand auf dem Server (im Tresor verschlüsselt) */
  server: Note | null
  mine: { format: NoteFormat; content: string }
  vault: boolean
  onClose: () => void
  onResolve: (mode: 'mine' | 'theirs' | 'copy') => void
}) {
  const plain = useDecrypted(open && vault && server ? { id: server.id, field: 'content', envelope: server.content } : null)
  const theirs = !server ? null : vault ? (typeof plain === 'string' ? plain : null) : server.content
  const resolve = (mode: 'mine' | 'theirs' | 'copy') => {
    onClose()
    onResolve(mode)
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Unterschiede der beiden Versionen"
      description={
        server ? `Die andere Version wurde ${formatRelative(server.updatedAt)} auf einem anderen Gerät gespeichert.` : undefined
      }
      size="lg"
      footer={
        <>
          <Button onClick={() => resolve('copy')}>Beide behalten</Button>
          <Button onClick={() => resolve('theirs')}>Andere Version</Button>
          <Button variant="primary" onClick={() => resolve('mine')}>
            Meine Version
          </Button>
        </>
      }
    >
      <div className="max-h-[55vh] overflow-y-auto">
        {plain instanceof VaultError ? (
          <ErrorText>{plain.message}</ErrorText>
        ) : server && theirs !== null ? (
          <DiffView
            before={noteText(server.format, theirs)}
            after={noteText(mine.format, mine.content)}
            labels={{ removed: 'nur in der anderen Version', added: 'nur in deiner Version' }}
          />
        ) : (
          <Loader2 className="mx-auto my-8 size-5 animate-spin text-faint" />
        )}
      </div>
    </Modal>
  )
}
