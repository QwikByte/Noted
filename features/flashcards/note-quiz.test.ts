import { describe, expect, it } from 'vitest'
import { quizSections } from './note-quiz'
import { parseCardsFromNote } from './card-markdown'

const NOTE = [
  '---',
  'tags: [analysis]',
  '---',
  'Einleitung ohne Überschrift',
  '',
  '# Folgen',
  '## Grenzwert',
  'Eine Folge konvergiert gegen $a$, wenn …',
  '',
  '### Beispiel',
  '%%nur ein Kommentar%%',
  '### Nullfolge',
  '- $1/n$',
  '```',
  '# kein Abschnitt',
  '```',
  '## Cauchy-Folge',
  '',
  '# Reihen',
  'Summe der Folgenglieder',
].join('\n')

describe('Notiz abfragen', () => {
  it('macht jede Überschrift mit eigenem Text zur Frage', () => {
    const sections = quizSections(NOTE)
    expect(sections.map((s) => s.heading)).toEqual(['Grenzwert', 'Nullfolge', 'Reihen'])
    expect(sections[0]).toEqual({ heading: 'Grenzwert', path: ['Folgen'], body: 'Eine Folge konvergiert gegen $a$, wenn …', line: 6 })
    // Code-Blöcke gehören zum Abschnitt, Überschriften darin zählen nicht
    expect(sections[1]).toMatchObject({ path: ['Folgen', 'Grenzwert'], body: '- $1/n$\n```\n# kein Abschnitt\n```', line: 11 })
    expect(sections[2]).toMatchObject({ path: [], body: 'Summe der Folgenglieder', line: 18 })
  })

  it('findet dieselben Zeilen wie die Überschriften in „Karteikarten aus Notiz“', () => {
    const headingCards = parseCardsFromNote(NOTE).filter((c) => c.source === 'heading')
    for (const s of quizSections(NOTE)) expect(headingCards.some((c) => c.line === s.line)).toBe(true)
  })

  it('liefert ohne Überschriften nichts', () => {
    expect(quizSections('Nur Text\n\n- eine Liste')).toEqual([])
    expect(quizSections('')).toEqual([])
  })
})
