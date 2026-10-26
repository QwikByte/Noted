import { describe, expect, it } from 'vitest'
import { parseCardsFromNote } from './card-markdown'
import { SIMILARITY, changedParts, noteCards, similarity, syncCards } from './note-sync'
import type { Card, CardOption, CardType } from './types'

let nextId = 0
function card(type: CardType, front: string, back = '', options: CardOption[] = [], noteId: string | null = 'n1'): Card {
  return {
    id: `c${++nextId}`,
    deckId: 'd1',
    noteId,
    type,
    front,
    back,
    options,
    occlusion: null,
    position: nextId,
    suspended: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

const sync = (note: string, cards: Card[]) => {
  const candidates = parseCardsFromNote(note)
  const r = syncCards(candidates, cards)
  return {
    unchanged: r.unchanged.map(({ candidate, card }) => [candidates[candidate].front, card.id]),
    changed: r.changed.map(({ candidate, card, exact }) => [candidates[candidate].front, card.id, exact]),
    added: r.added.map((i) => candidates[i].front),
    orphaned: r.orphaned.map((c) => c.id),
  }
}

describe('syncCards', () => {
  it('erkennt unveränderte, geänderte, neue und verwaiste Grundkarten', () => {
    const same = card('basic', 'Was ist ein Körper?', 'Eine Menge mit + und ·')
    const answer = card('basic', 'Was ist ein Ring?', 'Eine Menge mit +')
    const gone = card('basic', 'Was ist ein Modul?', 'Ein Vektorraum über einem Ring')
    const r = sync(
      'Was ist ein Körper?::Eine  Menge mit + und ·\nWas ist ein Ring?::Eine Menge mit + und ·, assoziativ\nWas ist eine Gruppe?::Menge mit ∘',
      [same, answer, gone],
    )
    expect(r.unchanged).toEqual([['Was ist ein Körper?', same.id]])
    expect(r.changed).toEqual([['Was ist ein Ring?', answer.id, true]])
    expect(r.added).toEqual(['Was ist eine Gruppe?'])
    expect(r.orphaned).toEqual([gone.id])
  })

  it('ohne Änderungen ist alles unverändert', () => {
    const a = card('basic', 'Frage A', 'Antwort A')
    const b = card('reversed', 'Haus', 'house')
    expect(sync('Frage A::Antwort A\n\nHaus:::house', [a, b])).toEqual({
      unchanged: [
        ['Frage A', a.id],
        ['Haus', b.id],
      ],
      changed: [],
      added: [],
      orphaned: [],
    })
  })

  it('Groß- und Kleinschreibung der Antwort ist eine Änderung, Leerraum nicht', () => {
    const c = card('basic', 'Hauptstadt von Frankreich?', 'paris')
    expect(sync('Hauptstadt von  Frankreich?::Paris', [c]).changed).toEqual([['Hauptstadt von  Frankreich?', c.id, true]])
    expect(sync('Hauptstadt von  Frankreich?::paris', [c]).unchanged).toHaveLength(1)
  })

  it('beidseitige Karten: ein anderer Typ ist kein exakter Treffer, aber ein Vorschlag', () => {
    const c = card('basic', 'Haus', 'house')
    const r = sync('Haus:::house', [c])
    expect(r.changed).toEqual([['Haus', c.id, false]])
    expect(changedParts(c, parseCardsFromNote('Haus:::house')[0])).toEqual(['type'])
  })

  it('Multiple Choice mit geänderten Antworten', () => {
    const c = card('mc', 'Welche Aussagen stimmen?', '', [
      { text: 'richtig', correct: true },
      { text: 'falsch', correct: false },
    ])
    const note = 'Welche Aussagen stimmen?\n?\n- [x] richtig\n- [x] auch richtig\n- [ ] falsch'
    expect(sync(note, [c]).changed).toEqual([['Welche Aussagen stimmen?', c.id, true]])
    expect(changedParts(c, parseCardsFromNote(note)[0])).toEqual(['back'])
    // Andere Reihenfolge der Antworten: geändert (sie ist Teil der Karte)
    expect(sync('Welche Aussagen stimmen?\n?\n- [ ] falsch\n- [x] richtig', [c]).changed).toHaveLength(1)
  })

  it('Lückentext: neue Antwort in der Lücke ist geändert, ein Zusatz auf der Karte zählt nicht', () => {
    const c = card('cloze', 'Die Hauptstadt von Frankreich ist ==Paris==.', 'Seit dem Mittelalter')
    expect(sync('Die Hauptstadt von Frankreich ist {{Paris}}.', [c]).unchanged).toHaveLength(1)
    const note = 'Die Hauptstadt von Frankreich ist ==Lyon==.'
    expect(sync(note, [c]).changed).toEqual([[note, c.id, true]])
    expect(changedParts(c, parseCardsFromNote(note)[0])).toEqual(['front'])
    // Anderer Text um die Lücke: nur ein Vorschlag
    const longer = 'Die Hauptstadt von Frankreich ist seit langem ==Paris==.'
    expect(sync(longer, [c]).changed).toEqual([[longer, c.id, false]])
  })

  it('dieselbe Vorderseite zweimal: Zuordnung in der Reihenfolge, gleicher Inhalt zuerst', () => {
    const first = card('basic', 'Definition', 'alt')
    const second = card('basic', 'Definition', 'zwei')
    const r = sync('Definition::eins\nDefinition::zwei', [first, second])
    expect(r.unchanged).toEqual([['Definition', second.id]])
    expect(r.changed).toEqual([['Definition', first.id, true]])
    // Eine Karte, zwei Kandidaten: der zweite ist neu
    const only = card('basic', 'Definition', 'eins')
    expect(sync('Definition::eins\nDefinition::eins', [only])).toMatchObject({ unchanged: [['Definition', only.id]], added: ['Definition'] })
  })

  it('umformulierte Frage: Vorschlag ab der Ähnlichkeitsschwelle, sonst neu und verwaist', () => {
    const c = card('basic', 'Was besagt der Satz von Bayes?', 'P(A|B) = …')
    const r = sync('Was besagt der Satz von Bayes genau?::P(A|B) = …', [c])
    expect(r.changed).toEqual([['Was besagt der Satz von Bayes genau?', c.id, false]])
    expect(changedParts(c, parseCardsFromNote('Was besagt der Satz von Bayes genau?::P(A|B) = …')[0])).toEqual(['front'])

    const far = sync('Bayes?::P(A|B) = …', [c])
    expect(far.changed).toEqual([])
    expect(far.added).toEqual(['Bayes?'])
    expect(far.orphaned).toEqual([c.id])
  })

  it('ähnlichste Paare zuerst', () => {
    const a = card('basic', 'Satz von Bayes Formel', 'x')
    const b = card('basic', 'Satz von Bayes', 'y')
    const r = sync('Satz von Bayes Formel herleiten::x\nder Satz von Bayes::y', [b, a])
    expect(r.changed).toEqual([
      ['Satz von Bayes Formel herleiten', a.id, false],
      ['der Satz von Bayes', b.id, false],
    ])
  })
})

describe('similarity', () => {
  it('Anteil gemeinsamer Wörter', () => {
    expect(similarity('Was ist ein Körper?', 'was ist ein körper')).toBe(1)
    expect(similarity('a b c', 'a b d')).toBe(0.5)
    expect(similarity('', 'a')).toBe(0)
    expect(similarity('a b c d e', 'a b c d f')).toBeGreaterThanOrEqual(SIMILARITY)
  })
})

describe('noteCards', () => {
  it('nur Karten dieser Notiz und keine Bildverdeckungen', () => {
    const mine = card('basic', 'A', 'B')
    const other = card('basic', 'A', 'B', [], 'n2')
    const loose = card('basic', 'A', 'B', [], null)
    const image = card('occlusion', 'Bild')
    expect(noteCards([mine, other, loose, image], 'n1')).toEqual([mine])
  })
})
