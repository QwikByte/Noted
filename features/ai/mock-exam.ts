// Probeklausur: Stand einer laufenden Klausur, Punkte und Ergebnis als Markdown für eine Notiz. Reine Logik – den
// Stand auf dem Gerät hält client/mock-exam.ts, die Ansicht components/MockExamView.tsx.
import { VERDICT_LABELS } from './grade'
import type { AiImage, GradeResult, QuizQuestion } from './types'

/** Antwort auf eine Aufgabe: Text und/oder Fotos der handschriftlichen Lösung */
export type ExamAnswer = { text: string; photos: AiImage[] }

/**
 * Laufende oder abgegebene Probeklausur. `scope`: Klausur (`exam:<Termin>`) oder Stapel (`deck:<id>`), `startedAt`:
 * Beginn der Bearbeitung, `results`: Korrektur nach der Abgabe, `truncated`: Claude hat nur einen Teil der Unterlagen
 * gesehen
 */
export type MockExam = {
  scope: string
  title: string
  deckIds: string[]
  questions: QuizQuestion[]
  answers: ExamAnswer[]
  startedAt: number
  submittedAt: number | null
  results: GradeResult[] | null
  truncated: boolean
}

/** Erreichbare Punkte bzw. – nach der Korrektur – erreichte */
export function examPoints(exam: Pick<MockExam, 'questions' | 'results'>): { points: number; max: number; percent: number } {
  const max = exam.questions.reduce((sum, q) => sum + q.points, 0)
  const points = exam.results?.reduce((sum, r) => sum + r.points, 0) ?? 0
  return { points, max, percent: max ? Math.round((points / max) * 100) : 0 }
}

export const isAnswered = (a: ExamAnswer | undefined) => !!a && (a.text.trim() !== '' || a.photos.length > 0)

const num = (n: number) => n.toLocaleString('de-DE')

/** Abgegebene Probeklausur als Markdown-Notiz: Aufgaben, Antworten, Bewertung und Musterlösungen */
export function examMarkdown(exam: MockExam, date: string): string {
  const { points, max, percent } = examPoints(exam)
  const lines = [`# Probeklausur: ${exam.title}`, '', `${date} · ${num(points)} von ${num(max)} Punkten (${percent} %)`]
  exam.questions.forEach((q, i) => {
    const answer = exam.answers[i]
    const result = exam.results?.[i]
    const score = result ? `${num(result.points)}/${num(q.points)}` : num(q.points)
    lines.push('', `## Aufgabe ${i + 1} (${score} ${q.points === 1 ? 'Punkt' : 'Punkte'})`, '', q.question.trim(), '', '**Deine Antwort:**', '')
    const text = answer?.text.trim()
    const photos = answer?.photos.length ?? 0
    lines.push(text || (photos ? '' : '_Keine Antwort_'))
    if (photos) lines.push(`${text ? '\n' : ''}_(${photos === 1 ? 'mit einem Foto' : `mit ${photos} Fotos`} – nicht in dieser Notiz)_`)
    if (result) lines.push('', `**Bewertung:** ${VERDICT_LABELS[result.verdict]}${result.feedback ? ` – ${result.feedback}` : ''}`)
    lines.push('', '**Musterlösung:**', '', q.answer.trim())
  })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
}
