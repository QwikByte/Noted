import { describe, expect, it } from 'vitest'
import { examMarkdown, examPoints, isAnswered, type MockExam } from './mock-exam'

const exam: MockExam = {
  scope: 'exam:e1',
  title: 'Thermodynamik',
  deckIds: ['d1'],
  questions: [
    { question: 'Definiere Entropie.', answer: 'Maß für Unordnung (2 P.)', points: 2, topic: 'Entropie' },
    { question: 'Berechne ΔU.', answer: 'ΔU = Q + W = 5 J', points: 4, topic: 'Hauptsätze' },
    { question: 'Nenne ein Beispiel.', answer: 'Eis schmilzt.', points: 1, topic: '' },
  ],
  answers: [
    { text: 'Unordnung', photos: [] },
    { text: '', photos: [{ mediaType: 'image/jpeg', data: 'AAAA' }] },
    { text: '  ', photos: [] },
  ],
  startedAt: 0,
  submittedAt: 60_000,
  results: [
    { verdict: 'correct', points: 2, feedback: 'Gut.' },
    { verdict: 'partial', points: 2.5, feedback: 'Vorzeichen von W falsch.' },
    { verdict: 'wrong', points: 0, feedback: 'Keine Antwort.' },
  ],
  truncated: false,
}

describe('Probeklausur', () => {
  it('zählt Punkte und erkennt leere Antworten', () => {
    expect(examPoints(exam)).toEqual({ points: 4.5, max: 7, percent: 64 })
    expect(examPoints({ ...exam, results: null })).toEqual({ points: 0, max: 7, percent: 0 })
    expect(exam.answers.map(isAnswered)).toEqual([true, true, false])
  })

  it('schreibt das Ergebnis als Notiz mit Antworten, Bewertung und Musterlösungen', () => {
    expect(examMarkdown(exam, '27.10.2026')).toBe(
      [
        '# Probeklausur: Thermodynamik',
        '',
        '27.10.2026 · 4,5 von 7 Punkten (64 %)',
        '',
        '## Aufgabe 1 (2/2 Punkte)',
        '',
        'Definiere Entropie.',
        '',
        '**Deine Antwort:**',
        '',
        'Unordnung',
        '',
        '**Bewertung:** Richtig – Gut.',
        '',
        '**Musterlösung:**',
        '',
        'Maß für Unordnung (2 P.)',
        '',
        '## Aufgabe 2 (2,5/4 Punkte)',
        '',
        'Berechne ΔU.',
        '',
        '**Deine Antwort:**',
        '',
        '_(mit einem Foto – nicht in dieser Notiz)_',
        '',
        '**Bewertung:** Teilweise richtig – Vorzeichen von W falsch.',
        '',
        '**Musterlösung:**',
        '',
        'ΔU = Q + W = 5 J',
        '',
        '## Aufgabe 3 (0/1 Punkt)',
        '',
        'Nenne ein Beispiel.',
        '',
        '**Deine Antwort:**',
        '',
        '_Keine Antwort_',
        '',
        '**Bewertung:** Falsch – Keine Antwort.',
        '',
        '**Musterlösung:**',
        '',
        'Eis schmilzt.',
        '',
      ].join('\n'),
    )
  })
})
