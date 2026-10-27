'use client'
// Beim Lernen: Claude erklärt eine Karte – mit der Notiz, aus der sie stammt, als Hintergrund
import { useNote } from '@/features/notes/client/queries'
import { noteText } from '@/features/notes/format'
import { MAX_AI_NOTE_CHARS } from '../limits'
import { AiAssistant } from './AiAssistant'

export function AiCardExplain({
  title,
  question,
  answer,
  noteId,
  onClose,
}: {
  /** Name des Stapels */
  title: string
  question: string
  answer: string
  noteId: string | null
  onClose: () => void
}) {
  const note = useNote(noteId, !!noteId)
  // Erst öffnen, wenn die Notiz da ist (oder sich nicht laden lässt) – die Erklärung startet sofort
  if (noteId && note.isLoading) return null
  const context = note.data && !note.data.vault ? noteText(note.data.format, note.data.content).slice(0, MAX_AI_NOTE_CHARS) : undefined
  return (
    <AiAssistant
      title={title}
      noteId={context ? (noteId ?? undefined) : undefined}
      scopes={[{ label: 'Karte', text: `Frage:\n${question.trim()}\n\nAntwort:\n${answer.trim()}`, context }]}
      answerOnly
      initialAction="explain"
      onClose={onClose}
    />
  )
}
