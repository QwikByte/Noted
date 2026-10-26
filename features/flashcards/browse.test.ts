import { describe, expect, it } from 'vitest'
import { NO_FILTER, browseCards, cardMatches, type BrowseFilter } from './browse'
import { reviewKey, type StateMap } from './study'
import type { Card, CardType, Deck, SrsState } from './types'

const DAY = 86_400_000
const NOW = new Date('2026-10-26T10:00:00').getTime()

let n = 0
function card(deckId: string, front: string, extra: Partial<Card> = {}): Card {
  n++
  return {
    id: `c${n}`,
    deckId,
    noteId: null,
    type: 'basic' as CardType,
    front,
    back: '',
    options: [],
    occlusion: null,
    position: n,
    suspended: false,
    createdAt: n,
    updatedAt: n,
    ...extra,
  }
}

const deck = (id: string, name: string) => ({ id, name }) as Deck

function state(extra: Partial<SrsState> = {}): SrsState {
  return { phase: 'review', step: 0, interval: 5, ease: 2.5, reps: 3, lapses: 0, due: NOW + 3 * DAY, reviewedAt: NOW, introducedAt: 0, ...extra }
}

const analysis = deck('d1', 'Analysis')
const chemie = deck('d2', 'Chemie')
const taylor = card('d1', 'Taylorreihe von e^x', { back: 'Summe x^n / n!' })
const folge = card('d1', 'Was ist eine Folge?', { noteId: 'n1', suspended: true })
const mol = card('d2', 'Was ist ein Mol?', { type: 'reversed' })
const mc = card('d2', 'Welche Stoffe sind Säuren?', { type: 'mc', options: [{ text: 'Essig', correct: true }, { text: 'Lauge', correct: false }] })
const cards = [taylor, folge, mol, mc]
const states: StateMap = new Map([
  [reviewKey(taylor.id, 0), state({ due: NOW - DAY, lapses: 7, difficulty: 8 })],
  [reviewKey(mol.id, 0), state({ interval: 30, due: NOW + 40 * DAY, difficulty: 3 })],
  [reviewKey(mol.id, 1), state({ phase: 'learning', interval: 0, due: NOW + 600_000 })],
  [reviewKey(folge.id, 0), state({ due: NOW, lapses: 1, ease: 1.3 })],
])

const ids = (filter: Partial<BrowseFilter>, sort: Parameters<typeof browseCards>[4] = 'position') =>
  browseCards(cards, [chemie, analysis], states, { ...NO_FILTER, ...filter }, sort, NOW).map((c) => c.id)

describe('Kartenbrowser', () => {
  it('sucht in Vorder- und Rückseite, Antworten und Beschriftungen', () => {
    expect(cardMatches(taylor, 'N!')).toBe(true)
    expect(cardMatches(mc, 'essig')).toBe(true)
    expect(cardMatches(mc, 'basen')).toBe(false)
    const occlusion = card('d1', 'Herz', { type: 'occlusion', occlusion: { image: 'h.png', hideAll: false, masks: [{ x: 0, y: 0, w: 1, h: 1, label: 'Aorta' }] } })
    expect(cardMatches(occlusion, 'aorta')).toBe(true)
    expect(ids({ query: 'was ist' })).toEqual([folge.id, mol.id])
  })

  it('filtert nach Stapel, Art, Stand, Fälligkeit, Problemkarte, ausgesetzt und Notiz – kombiniert', () => {
    expect(ids({ deckId: 'd2' })).toEqual([mol.id, mc.id])
    expect(ids({ type: 'mc' })).toEqual([mc.id])
    expect(ids({ status: 'new' })).toEqual([mc.id])
    expect(ids({ status: 'learning' })).toEqual([mol.id])
    expect(ids({ status: 'mature' })).toEqual([mol.id])
    // Heute fällig (auch die Lernphase in zehn Minuten) – die ausgesetzte Folge nicht
    expect(ids({ due: true })).toEqual([taylor.id, mol.id])
    expect(ids({ problem: true })).toEqual([taylor.id])
    expect(ids({ suspended: true })).toEqual([folge.id])
    expect(ids({ fromNote: true })).toEqual([folge.id])
    expect(ids({ deckId: 'd1', query: 'folge' })).toEqual([folge.id])
    expect(ids({ deckId: 'd2', problem: true })).toEqual([])
  })

  it('sortiert nach Stapel, angelegt, Fälligkeit, Lapses und Schwierigkeit', () => {
    // Stapel nach Name, darin die Reihenfolge des Stapels
    expect(ids({})).toEqual([taylor.id, folge.id, mol.id, mc.id])
    expect(ids({}, 'created')).toEqual([mc.id, mol.id, folge.id, taylor.id])
    // Früheste Fälligkeit zuerst, neue Karten zuletzt
    expect(ids({}, 'due')).toEqual([taylor.id, folge.id, mol.id, mc.id])
    expect(ids({}, 'lapses')).toEqual([taylor.id, folge.id, mol.id, mc.id])
    // FSRS 8 > SM-2 mit Leichtigkeit 1,3 (= 1) … neue Karten zuletzt
    expect(ids({}, 'difficulty')).toEqual([folge.id, taylor.id, mol.id, mc.id])
  })
})
