import { describe, expect, it } from 'vitest'
import { cardsPrompt, parseSuggestedCards } from './cards'
import { MAX_AI_CARDS } from './limits'

const reply = (cards: unknown[]) => JSON.stringify({ cards })
const basic = (front: string, back = 'Antwort') => ({ type: 'basic', front, back, options: [] })

describe('Anfrage an Claude', () => {
  it('schickt die Notiz ohne Frontmatter, mit vorhandenen Karten und Wünschen', () => {
    const prompt = cardsPrompt({
      title: 'Analysis I',
      content: '---\ntags: [uni]\n---\n# Grenzwerte\nEine Folge konvergiert …',
      existing: ['Was ist eine   Cauchy-Folge?', 'x'.repeat(400)],
      wishes: ' nur Definitionen ',
    })
    expect(prompt).toContain('Titel der Notiz: Analysis I')
    expect(prompt).toContain('<notiz>\n# Grenzwerte\nEine Folge konvergiert …\n</notiz>')
    expect(prompt).not.toContain('tags: [uni]')
    expect(prompt).toContain('- Was ist eine Cauchy-Folge?')
    // Lange Vorderseiten nur angefangen
    expect(prompt).toContain(`- ${'x'.repeat(300)}\n`)
    expect(prompt).not.toContain('x'.repeat(301))
    expect(prompt).toMatch(/Wünsche zu den Karten: nur Definitionen$/)
  })

  it('lässt leere Teile weg', () => {
    const prompt = cardsPrompt({ title: ' ', content: 'Text', existing: [' '], wishes: '' })
    expect(prompt).toBe('Titel der Notiz: Ohne Titel\n\n<notiz>\nText\n</notiz>')
  })
})

describe('Antwort von Claude', () => {
  it('liest nur gültiges JSON im erwarteten Format', () => {
    expect(parseSuggestedCards('{"cards": [')).toBeNull()
    expect(parseSuggestedCards('{"karten": []}')).toBeNull()
    expect(parseSuggestedCards(reply([]))).toEqual([])
  })

  it('übernimmt Karten nach denselben Regeln wie beim Speichern', () => {
    const cards = parseSuggestedCards(
      reply([
        basic('  Was ist ein Körper?\r\n', ' Eine Menge mit + und · … '),
        { type: 'Reversed', front: 'Haus', back: 'house', options: [] },
        { type: 'cloze', front: 'Die {{Ableitung}} von $x^2$ ist ==2x==.', back: '', options: [] },
        { type: 'mc', front: 'Welche Zahl ist prim?', back: '', options: [{ text: '4', correct: false }, { text: ' 7\n', correct: true }] },
      ]),
    )
    expect(cards).toEqual([
      { type: 'basic', front: 'Was ist ein Körper?', back: 'Eine Menge mit + und · …', options: [] },
      { type: 'reversed', front: 'Haus', back: 'house', options: [] },
      { type: 'cloze', front: 'Die ==Ableitung== von $x^2$ ist ==2x==.', back: '', options: [] },
      { type: 'mc', front: 'Welche Zahl ist prim?', back: '', options: [{ text: '4', correct: false }, { text: '7', correct: true }] },
    ])
  })

  it('verwirft unbrauchbare Karten einzeln', () => {
    const cards = parseSuggestedCards(
      reply([
        basic('Ohne Antwort', ' '),
        basic(' ', 'Ohne Frage'),
        { type: 'cloze', front: 'Ein Satz ohne Lücke', back: '', options: [] },
        { type: 'mc', front: 'Nur eine Antwort?', back: '', options: [{ text: 'ja', correct: true }] },
        { type: 'mc', front: 'Keine richtig?', back: '', options: [{ text: 'a', correct: false }, { text: 'b', correct: false }] },
        { type: 'occlusion', front: 'Bild', back: '', options: [] },
        { front: 'Ohne Typ' },
        basic('x'.repeat(20_001)),
        basic('Bleibt'),
      ]),
    )
    expect(cards).toEqual([basic('Bleibt')])
  })

  it('nimmt jede Vorderseite nur einmal und höchstens MAX_AI_CARDS Karten', () => {
    expect(parseSuggestedCards(reply([basic('Was ist  Entropie?'), basic('was ist entropie?', 'Andere')]))).toEqual([
      basic('Was ist  Entropie?'),
    ])
    const many = Array.from({ length: MAX_AI_CARDS + 5 }, (_, i) => basic(`Frage ${i}`))
    expect(parseSuggestedCards(reply(many))).toHaveLength(MAX_AI_CARDS)
  })
})
