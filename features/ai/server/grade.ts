import 'server-only'
import { answeredItems, GRADE_SCHEMA, gradePrompt, parseGrades, UNANSWERED } from '../grade'
import type { GradeRequest, GradeResult } from '../types'
import { invalidAnswer, structured } from './claude'
import { checkNoteForAi } from './note-access'
import { requireAiCredentials } from './settings'

/**
 * Lässt Claude Antworten bewerten – eine eingetippte Antwort beim Lernen ebenso wie alle Aufgaben einer Probeklausur.
 * Unbeantwortete Aufgaben gehen nicht an Claude und zählen 0 Punkte.
 */
export async function gradeAnswers(userId: number, req: GradeRequest, signal?: AbortSignal): Promise<GradeResult[]> {
  const credentials = requireAiCredentials(userId)
  if (req.noteId) checkNoteForAi(userId, req.noteId)
  const items = answeredItems(req.items)
  if (!items.length) return req.items.map(() => UNANSWERED)
  // Eine einzelne getippte Antwort soll schnell beurteilt sein; Klausuren und Fotos brauchen mehr Sorgfalt
  const thorough = items.length > 1 || items.some(({ item }) => item.images?.length)
  const text = await structured(
    credentials,
    gradePrompt({ title: req.title, context: req.context, items }),
    {
      schema: GRADE_SCHEMA,
      maxTokens: thorough ? 32_000 : 8_000,
      effort: thorough ? 'medium' : 'low',
      tooLong: 'Die Bewertung wurde zu lang. Versuch es noch einmal.',
    },
    signal,
  )
  const results = text === undefined ? null : parseGrades(text, req.items)
  if (!results) throw invalidAnswer('Bewertung')
  return results
}
