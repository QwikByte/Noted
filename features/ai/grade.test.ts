import { describe, expect, it } from 'vitest'
import { answeredItems, gradePrompt, parseGrades } from './grade'
import type { PromptPart } from './prompt'

const texts = (parts: PromptPart[]) => parts.map((p) => (p.kind === 'text' ? p.text : '[Bild]'))
const IMAGE = { mediaType: 'image/jpeg' as const, data: 'AAAA' }

describe('Antworten bewerten: Anfrage', () => {
  it('nummeriert die Aufgaben, lässt unbeantwortete weg und hängt Fotos an ihre Aufgabe', () => {
    const items = [
      { question: 'Was ist Entropie?', expected: 'Maß für Unordnung', answer: ' Unordnung ' },
      { question: 'Erster Hauptsatz?', expected: 'Energieerhaltung', answer: '  ' },
      { question: 'Rechne 2a)', expected: 'ΔU = 5 J (2 P.)', answer: '', images: [IMAGE], points: 4 },
    ]
    const numbered = answeredItems(items)
    expect(numbered.map((n) => n.nr)).toEqual([1, 3])
    const { system, parts } = gradePrompt({ title: 'Thermo', context: 'Abschnitt über Entropie', items: numbered })
    expect(system).toContain('Bewerte den Inhalt, nicht die Form')
    expect(texts(parts)).toEqual([
      'Thema: Thermo',
      'Zusammenhang, nur zum Verständnis:\n<kontext>\nAbschnitt über Entropie\n</kontext>',
      '<aufgabe nr="1">\nFrage:\nWas ist Entropie?\n\nMusterlösung:\nMaß für Unordnung\n\nAntwort:\nUnordnung\n</aufgabe>',
      '<aufgabe nr="3" punkte="4">\nFrage:\nRechne 2a)\n\nMusterlösung:\nΔU = 5 J (2 P.)\n\nAntwort:\n(nur Foto)\n</aufgabe>',
      'Foto zur Antwort auf Aufgabe 3:',
      '[Bild]',
    ])
  })
})

describe('Antworten bewerten: Ergebnis', () => {
  const items = [
    { question: 'A', expected: 'a', answer: 'x' },
    { question: 'B', expected: 'b', answer: '' },
    { question: 'C', expected: 'c', answer: 'y', points: 4 },
  ]

  it('ordnet nach Nummer zu, rundet Punkte auf halbe und begrenzt sie', () => {
    const text = JSON.stringify({
      results: [
        { nr: 3, verdict: 'Partial', points: 2.3, feedback: ' Teil b fehlt. ' },
        { nr: 1, verdict: 'correct', points: 7, feedback: 'Stimmt.' },
      ],
    })
    expect(parseGrades(text, items)).toEqual([
      // Ohne Punktzahl der Aufgabe zählt nur das Urteil
      { verdict: 'correct', points: 1, feedback: 'Stimmt.' },
      { verdict: 'wrong', points: 0, feedback: 'Keine Antwort.' },
      { verdict: 'partial', points: 2.5, feedback: 'Teil b fehlt.' },
    ])
    const over = JSON.stringify({ results: [{ nr: 1, verdict: 'wrong', points: 0, feedback: '' }, { nr: 3, verdict: 'correct', points: 9, feedback: '' }] })
    expect(parseGrades(over, items)?.[2].points).toBe(4)
  })

  it('verwirft Antworten, in denen eine beantwortete Aufgabe fehlt oder das Format nicht passt', () => {
    expect(parseGrades(JSON.stringify({ results: [{ nr: 1, verdict: 'correct', points: 1, feedback: '' }] }), items)).toBeNull()
    expect(parseGrades('kein JSON', items)).toBeNull()
    expect(parseGrades(JSON.stringify({ results: [{ nr: 1, verdict: 'super', points: 1, feedback: '' }] }), items.slice(0, 1))).toBeNull()
  })
})
