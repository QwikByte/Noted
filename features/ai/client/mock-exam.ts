'use client'
// Laufende Probeklausur auf dem Gerät: übersteht Neuladen und Wegnavigieren. Es gibt nur eine zur Zeit; beim Abmelden
// wird sie gelöscht (sie gehört zum Konto).
import type { MockExam } from '../mock-exam'

export const MOCK_EXAM_KEY = 'noted:mock-exam'

export function loadMockExam(): MockExam | null {
  try {
    const raw = JSON.parse(localStorage.getItem(MOCK_EXAM_KEY) ?? 'null') as MockExam | null
    return raw && Array.isArray(raw.questions) && Array.isArray(raw.answers) ? raw : null
  } catch {
    return null
  }
}

/**
 * Stand speichern (null löscht). Passen die Fotos nicht in den Speicher des Browsers, wird ohne sie gespeichert –
 * dann false: Die Fotos gibt es nur, bis die Seite neu geladen wird.
 */
export function saveMockExam(exam: MockExam | null): boolean {
  try {
    if (!exam) localStorage.removeItem(MOCK_EXAM_KEY)
    else localStorage.setItem(MOCK_EXAM_KEY, JSON.stringify(exam))
    return true
  } catch {
    try {
      if (exam) localStorage.setItem(MOCK_EXAM_KEY, JSON.stringify({ ...exam, answers: exam.answers.map((a) => ({ ...a, photos: [] })) }))
    } catch {
      /* Speicher ganz voll oder gesperrt – dann nur im Arbeitsspeicher */
    }
    return false
  }
}
