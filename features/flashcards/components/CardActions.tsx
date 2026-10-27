'use client'
// Aktionen einer Kartenliste (Stapel und „Alle Karten“): je Karte und für die Mehrfachauswahl – samt Rückfragen und
// dem Dialog zum Verschieben
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderInput, Pause, Play, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Field, Select } from '@/shared/ui/input'
import { ConfirmModal, Modal } from '@/shared/ui/modal'
import { SelectionBar, SelectionMenuItems, type SelectionAction } from '@/shared/ui/selection-bar'
import { useToast } from '@/shared/ui/toast'
import type { ListSelectionState } from '@/shared/client/list-selection'
import { errorMessage } from '@/shared/client/api'
import { useAiReady } from '@/features/ai/client/ai'
import { AiCardsDialog } from '@/features/ai/components/AiCardsDialog'
import { batchCards, deleteCard, resetCardProgress, updateCard, useFlashcards } from '../client/flashcards'
import { MAX_BATCH_CARDS } from '../limits'
import type { Card, CardBatchAction } from '../types'
import type { CardRowActions } from './CardRow'

const CARDS_NOUN = { one: 'Karte', many: 'Karten' }

const count = (n: number) => `${n} ${n === 1 ? 'Karte' : 'Karten'}`

const DONE: Record<CardBatchAction, (n: number) => string> = {
  move: (n) => `${count(n)} verschoben.`,
  suspend: (n) => `${count(n)} ausgesetzt.`,
  resume: (n) => `${count(n)} fortgesetzt.`,
  reset: (n) => `${count(n)} ${n === 1 ? 'gilt' : 'gelten'} wieder als neu.`,
  delete: (n) => `${count(n)} gelöscht.`,
}

/** Stapel wählen, in den die ausgewählten Karten kommen – sie behalten ihren Lernstand */
function MoveCardsDialog({ count: n, onMove, onClose }: { count: number; onMove: (deckId: string) => Promise<void>; onClose: () => void }) {
  const { data } = useFlashcards()
  const decks = data?.decks ?? []
  const [deckId, setDeckId] = useState(decks[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open
      onClose={onClose}
      title={`${count(n)} verschieben`}
      description="Die Karten behalten ihren Lernstand und kommen ans Ende des Stapels."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!deckId}
            onClick={async () => {
              setBusy(true)
              await onMove(deckId)
              setBusy(false)
            }}
          >
            Verschieben
          </Button>
        </>
      }
    >
      <Field label="In Stapel">
        {(id) => (
          <Select id={id} value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Modal>
  )
}

/** Karte mit KI in kleinere aufteilen – oft die Lösung für eine Problemkarte. Die alte wird danach ausgesetzt. */
function SplitDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const qc = useQueryClient()
  if (card.type === 'occlusion') return null
  const { type, front, back, options } = card
  return (
    <AiCardsDialog
      subject={front.length > 60 ? `${front.slice(0, 60)} …` : front}
      source={async () => ({ kind: 'card', mode: 'split', card: { type, front, back, options } })}
      autoStart
      deckId={card.deckId}
      deckName=""
      noteId={card.noteId}
      extra={
        card.suspended
          ? undefined
          : { label: 'Die bisherige Karte aussetzen', checked: true, run: () => updateCard(qc, card.id, { suspended: true }).then(() => {}) }
      }
      onClose={onClose}
    />
  )
}

/**
 * Aktionen je Karte und für die Auswahl. `bar` und `menu` gehören über die Liste bzw. in das Kontextmenü einer
 * ausgewählten Karte, `dialogs` irgendwo in die Seite.
 */
export function useCardActions(selection: ListSelectionState) {
  const qc = useQueryClient()
  const toast = useToast()
  const [toDelete, setToDelete] = useState<Card | null>(null)
  const [splitting, setSplitting] = useState<Card | null>(null)
  const aiReady = useAiReady()
  const [dialog, setDialog] = useState<'move' | 'reset' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const ids = selection.order.filter((id) => selection.ids.has(id))

  async function cardAction(action: () => Promise<unknown>, done: string) {
    try {
      await action()
      toast.success(done)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const rowActions: CardRowActions = {
    toggleSuspended: (card) =>
      void cardAction(() => updateCard(qc, card.id, { suspended: !card.suspended }), card.suspended ? 'Karte fortgesetzt.' : 'Karte ausgesetzt.'),
    relearn: (card) => void cardAction(() => resetCardProgress(qc, card.id), 'Die Karte gilt wieder als neu.'),
    remove: setToDelete,
    split: aiReady ? setSplitting : undefined,
  }

  async function batch(action: CardBatchAction, deckId?: string) {
    setBusy(true)
    try {
      const done = await batchCards(qc, action, ids, deckId)
      toast.success(DONE[action](done.length))
      setDialog(null)
      // Gelöschte Karten sind weg, verschobene oft auch aus der Liste – die übrigen Aktionen lassen die Auswahl stehen
      if (action === 'delete' || action === 'move') selection.stop()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const batchActions: SelectionAction[] = [
    { key: 'move', label: 'Verschieben …', icon: <FolderInput />, run: () => setDialog('move') },
    { key: 'suspend', label: 'Aussetzen', icon: <Pause />, run: () => void batch('suspend') },
    { key: 'resume', label: 'Fortsetzen', icon: <Play />, run: () => void batch('resume') },
    { key: 'reset', label: 'Neu lernen …', icon: <RotateCcw />, run: () => setDialog('reset') },
    { key: 'delete', label: 'Löschen …', icon: <Trash2 />, danger: true, run: () => setDialog('delete') },
  ]

  return {
    rowActions,
    bar: <SelectionBar selection={selection} actions={batchActions} max={MAX_BATCH_CARDS} noun={CARDS_NOUN} />,
    menu: <SelectionMenuItems selection={selection} actions={batchActions} max={MAX_BATCH_CARDS} noun={CARDS_NOUN} />,
    dialogs: (
      <>
        {splitting ? <SplitDialog card={splitting} onClose={() => setSplitting(null)} /> : null}
        {dialog === 'move' ? <MoveCardsDialog count={ids.length} onMove={(deckId) => batch('move', deckId)} onClose={() => setDialog(null)} /> : null}
        <ConfirmModal
          open={dialog === 'reset'}
          onClose={() => setDialog(null)}
          title={`${count(ids.length)} neu lernen?`}
          description="Der Lernstand dieser Karten wird zurückgesetzt, sie gelten wieder als neu. Ausgesetzte kommen wieder dran."
          confirmLabel="Neu lernen"
          danger
          loading={busy}
          onConfirm={() => void batch('reset')}
        />
        <ConfirmModal
          open={dialog === 'delete'}
          onClose={() => setDialog(null)}
          title={`${count(ids.length)} löschen?`}
          description="Die Karten und ihr Lernstand werden endgültig gelöscht."
          confirmLabel="Löschen"
          danger
          loading={busy}
          onConfirm={() => void batch('delete')}
        />
        <ConfirmModal
          open={!!toDelete}
          onClose={() => setToDelete(null)}
          title="Karte löschen?"
          description="Die Karte und ihr Lernstand werden endgültig gelöscht."
          confirmLabel="Löschen"
          danger
          loading={busy}
          onConfirm={async () => {
            if (!toDelete) return
            setBusy(true)
            try {
              await deleteCard(qc, toDelete.id)
            } catch (err) {
              toast.error(errorMessage(err))
            } finally {
              setBusy(false)
            }
            setToDelete(null)
          }}
        />
      </>
    ),
  }
}
