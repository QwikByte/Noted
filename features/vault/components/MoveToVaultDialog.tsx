'use client'
// Eine Notiz in den Tresor oder aus ihm heraus verschieben – der einzige Weg über die Grenze. Hinein wird sie im
// Browser verschlüsselt, heraus entschlüsselt; der Dialog sagt, was dabei nicht erreichbar ist.
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Lock, LockOpen } from 'lucide-react'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Field } from '@/shared/ui/input'
import { ErrorText, useToast } from '@/shared/ui/toast'
import { errorMessage } from '@/shared/client/api'
import { FolderSelect } from '@/features/notes/components/dialogs'
import { useFolders, useNote } from '@/features/notes/client/queries'
import { useFlashcards } from '@/features/flashcards/client/flashcards'
import { fileReferences } from '@/features/attachments/references'
import type { NoteSummary } from '@/features/notes/types'
import { useVaultInfo } from '../client/vault'
import { moveNoteIntoVault, moveNoteOutOfVault } from '../client/vault-notes'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function MoveToVaultDialog({
  note,
  folderId,
  onClose,
}: {
  note: NoteSummary
  /** Vorgeschlagenes Ziel, z. B. beim Ziehen */
  folderId?: string | null
  onClose: () => void
}) {
  const into = !note.vault
  const qc = useQueryClient()
  const toast = useToast()
  const { data: info } = useVaultInfo()
  const { data: folders = [] } = useFolders()
  const { data: full } = useNote(into ? note.id : null)
  const { data: flashcards } = useFlashcards()
  const [dest, setDest] = useState<string | null | undefined>(folderId)
  const [deleteCards, setDeleteCards] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const target = dest !== undefined ? dest : into ? (info?.folderId ?? null) : null
  // Nur Ordner auf der anderen Seite der Grenze
  const exclude = useMemo(() => new Set(folders.filter((f) => f.vault !== into).map((f) => f.id)), [folders, into])
  const cards = flashcards?.cards.filter((c) => c.noteId === note.id).length ?? 0
  const files = full ? fileReferences(full.format, full.content).size : 0

  async function submit() {
    setError(null)
    setLoading(true)
    try {
      if (into) {
        if (!target || exclude.has(target)) throw new Error('Wähle einen Ordner im Tresor.')
        const res = await moveNoteIntoVault(qc, note.id, target, deleteCards)
        toast.success(
          res.cards > 0
            ? `In den Tresor verschoben – ${plural(res.cards, 'Karteikarte', 'Karteikarten')} gelöscht.`
            : 'In den Tresor verschoben.',
        )
      } else {
        if (target && exclude.has(target)) throw new Error('Wähle einen Ordner außerhalb des Tresors.')
        await moveNoteOutOfVault(qc, note.id, target)
        toast.success('Aus dem Tresor verschoben.')
      }
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={into ? 'In den Tresor verschieben' : 'Aus dem Tresor verschieben'}
      description={`„${note.title}“`}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void submit()} loading={loading} disabled={into && !full}>
            {into ? <Lock className="size-4" /> : <LockOpen className="size-4" />} Verschieben
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <ErrorText>{error}</ErrorText>
        <Field label="Zielordner">
          {(id) => <FolderSelect id={id} value={target} onChange={setDest} exclude={exclude} noRoot={into} />}
        </Field>
        {into ? (
          <>
            <p>
              Titel und Inhalt werden in deinem Browser verschlüsselt. Verlauf, geteilte Links, Tags und Verweise der
              Notiz werden gelöscht; Suche, Rückverweise und Karteikarten gibt es im Tresor nicht.
            </p>
            {cards > 0 ? (
              <label className="flex items-start gap-2 rounded-lg border border-border p-3">
                <input
                  type="checkbox"
                  checked={deleteCards}
                  onChange={(e) => setDeleteCards(e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--accent)]"
                />
                <span>
                  {plural(cards, 'Karteikarte', 'Karteikarten')} aus dieser Notiz mitlöschen
                  <span className="block text-xs text-muted">
                    Sonst bleiben sie unverschlüsselt im Stapel, nur ohne Verbindung zur Notiz.
                  </span>
                </span>
              </label>
            ) : null}
            <div className="rounded-lg bg-warning-soft px-3 py-2.5 text-warning">
              <p className="font-medium">Nicht erreichbar ist der bisherige Klartext in:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>Sicherungen des Servers und früheren Exporten</li>
                <li>anderen Geräten, bis sie wieder online waren</li>
                <li>Teilen der Datenbank, die schon vor dem Tresor frei wurden, bis der Admin sie aufräumt</li>
              </ul>
              {files > 0 ? (
                <p className="mt-1.5">
                  {files === 1 ? 'Eine eingebettete Datei bleibt' : `${files} eingebettete Dateien bleiben`}{' '}
                  unverschlüsselt.
                </p>
              ) : null}
              <p className="mt-1.5">Wirklich Geheimes deshalb direkt im Tresor anlegen.</p>
            </div>
          </>
        ) : (
          <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-warning">
            Die Notiz ist danach unverschlüsselt und durchsuchbar.
          </p>
        )}
      </div>
    </Modal>
  )
}
