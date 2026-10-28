import { describe, expect, it } from 'vitest'
import { examMaterial, examPrompt, parseQuestions, tutorPrompt } from './questions'

const card = (front: string, back = '') => ({ front, back, options: [], labels: [] })

describe('Fragen: Anfrage', () => {
  it('Tutor: Notiz ohne Frontmatter, Anzahl in der Anweisung', () => {
    const { system, parts } = tutorPrompt({ title: 'Thermo', content: '---\ntags: [a]\n---\n# Entropie\nText', count: 6, wishes: ' nur Rechnen ' })
    expect(system).toContain('Höchstens 6 Fragen')
    expect(parts.map((p) => (p.kind === 'text' ? p.text : ''))).toEqual([
      'Titel der Notiz: Thermo\n\n<notiz>\n# Entropie\nText\n</notiz>',
      'Wünsche der Person: nur Rechnen',
    ])
  })

  it('Probeklausur: genaue Zahl der Aufgaben, Unterlagen als ein Block', () => {
    const { system, parts } = examPrompt({ title: 'Klausur Thermo', material: '<karte>\nA\n</karte>', count: 10 })
    expect(system).toContain('Genau 10 Aufgaben')
    expect(parts).toHaveLength(1)
    expect(parts[0]).toEqual({ kind: 'text', text: 'Fach bzw. Klausur: Klausur Thermo\n\n<unterlagen>\n<karte>\nA\n</karte>\n</unterlagen>' })
  })
})

describe('Fragen: Unterlagen der Probeklausur', () => {
  it('schreibt Karten samt Antworten und Beschriftungen, Notizen ohne Frontmatter', () => {
    const { text, truncated } = examMaterial(
      [
        card('Was ist Entropie?', 'Unordnung'),
        { front: 'Welche sind Hauptsätze?', back: '', options: [{ text: 'ΔU = Q + W', correct: true }, { text: 'F = ma', correct: false }], labels: [] },
        { front: 'Herz', back: '', options: [], labels: ['Aorta', 'Vorhof'] },
      ],
      [{ title: 'Wärme "kompakt"', text: '---\ntags: [x]\n---\nInhalt' }],
    )
    expect(truncated).toBe(false)
    expect(text).toBe(
      [
        '<karte>\nWas ist Entropie?\n→ Unordnung\n</karte>',
        '<karte>\nWelche sind Hauptsätze?\n- [x] ΔU = Q + W\n- [ ] F = ma\n</karte>',
        '<karte>\nHerz\nBeschriftungen im Bild: Aorta, Vorhof\n</karte>',
        "<notiz titel=\"Wärme 'kompakt'\">\nInhalt\n</notiz>",
      ].join('\n\n'),
    )
  })

  it('hält das Budget ein: Karten bis zu ihrem Anteil, Notizen gekürzt', () => {
    const cards = Array.from({ length: 50 }, (_, i) => card(`Frage ${i}`.padEnd(40, '.'), 'x'))
    const { text, truncated } = examMaterial(cards, [{ title: 'Lang', text: 'y'.repeat(5000) }], 2000)
    expect(truncated).toBe(true)
    expect(text.length).toBeLessThanOrEqual(2000)
    expect(text).toContain('<notiz titel="Lang">')
    expect(text).toContain(' …\n</notiz>')
    // Ohne Notizen bekommen die Karten das ganze Budget
    expect(examMaterial(cards.slice(0, 5), [], 2000)).toMatchObject({ truncated: false })
  })
})

describe('Fragen: Antwort', () => {
  const text = JSON.stringify({
    questions: [
      { question: ' Warum steigt die Entropie? ', answer: 'Weil …', points: 3, topic: '## Entropie' },
      { question: '', answer: 'leer', points: 1, topic: '' },
      { question: 'Rechne', answer: 'ΔU = 5 J', points: 40, topic: 'Hauptsätze' },
      { question: 'Zu viel', answer: 'x', points: 1 },
    ],
  })

  it('Tutor: Punkte immer 1, Überschrift ohne #, leere Fragen fallen weg', () => {
    expect(parseQuestions(text)).toEqual([
      { question: 'Warum steigt die Entropie?', answer: 'Weil …', points: 1, topic: 'Entropie' },
      { question: 'Rechne', answer: 'ΔU = 5 J', points: 1, topic: 'Hauptsätze' },
    ])
  })

  it('Probeklausur: Punkte zwischen 1 und 20, höchstens so viele wie verlangt', () => {
    expect(parseQuestions(text, { exam: true, max: 1 })).toEqual([
      { question: 'Warum steigt die Entropie?', answer: 'Weil …', points: 3, topic: 'Entropie' },
    ])
    expect(parseQuestions(text, { exam: true })?.[1].points).toBe(20)
    expect(parseQuestions('{"fragen": []}')).toBeNull()
  })
})
