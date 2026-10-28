import 'server-only'
import { getDeck, listDeckCards } from '@/features/flashcards/server/flashcards'
import { getNote } from '@/features/notes/server/notes'
import { noteText } from '@/features/notes/format'
import { ApiError, badRequest } from '@/shared/server/http'
import type { Prompt } from '../prompt'
import { examMaterial, examPrompt, parseQuestions, QUESTIONS_SCHEMA, tutorPrompt, type MaterialNote } from '../questions'
import type { QuestionsRequest, QuizQuestion } from '../types'
import { invalidAnswer, structured } from './claude'
import { checkNoteForAi } from './note-access'
import { requireAiCredentials } from './settings'

/**
 * Unterlagen einer Probeklausur: die Karten der Stapel und die Notizen, aus denen sie stammen. Notizen im Tresor oder
 * im Papierkorb bleiben draußen.
 */
function loadMaterial(userId: number, deckIds: string[]) {
  const ids = [...new Set(deckIds)]
  // Wirft 404, wenn ein Stapel nicht (mehr) existiert oder einem anderen Konto gehört
  for (const id of ids) getDeck(userId, id)
  const cards = listDeckCards(userId, ids)
  const notes: MaterialNote[] = []
  for (const noteId of new Set(cards.map((c) => c.noteId).filter((id): id is string => !!id))) {
    try {
      const note = getNote(userId, noteId)
      if (!note.vault) notes.push({ title: note.title, text: noteText(note.format, note.content) })
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err
    }
  }
  return examMaterial(
    cards.map((c) => ({ front: c.front, back: c.back, options: c.options, labels: c.occlusion?.masks.map((m) => m.label).filter(Boolean) ?? [] })),
    notes,
  )
}

/**
 * Lässt Claude Verständnisfragen zu einer Notiz bzw. die Aufgaben einer Probeklausur stellen. `truncated`: Die
 * Unterlagen der Klausur passten nicht ganz in die Anfrage.
 */
export async function generateQuestions(
  userId: number,
  req: QuestionsRequest,
  signal?: AbortSignal,
): Promise<{ questions: QuizQuestion[]; truncated: boolean }> {
  const credentials = requireAiCredentials(userId)
  const { source } = req
  let prompt: Prompt
  let truncated = false
  if (source.kind === 'note') {
    checkNoteForAi(userId, source.noteId)
    if (!source.content.trim()) throw badRequest('Die Notiz ist leer.')
    prompt = tutorPrompt({ title: source.title, content: source.content, count: req.count, wishes: req.wishes })
  } else {
    const material = loadMaterial(userId, source.deckIds)
    if (!material.text) throw badRequest('In den Stapeln gibt es noch keine Karten, aus denen Claude Aufgaben stellen könnte.')
    prompt = examPrompt({ title: source.title, material: material.text, count: req.count, wishes: req.wishes })
    truncated = material.truncated
  }
  const text = await structured(
    credentials,
    prompt,
    {
      schema: QUESTIONS_SCHEMA,
      maxTokens: 32_000,
      effort: 'medium',
      tooLong: 'Die Antwort wurde zu lang. Wähle weniger Aufgaben.',
    },
    signal,
  )
  const questions = text === undefined ? null : parseQuestions(text, { max: req.count, exam: source.kind === 'decks' })
  if (!questions?.length) throw invalidAnswer('Fragen')
  return { questions, truncated }
}
