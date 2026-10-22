import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as flashcards from '@/app/api/flashcards/route'
import * as fsrs from '@/app/api/flashcards/fsrs/route'
import * as decks from '@/app/api/decks/route'
import * as deckCards from '@/app/api/decks/[id]/cards/route'
import * as reviews from '@/app/api/reviews/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import { WEIGHT_CLAMPS } from './fsrs'
import type { Card, FlashcardData, FsrsOptimizeResult, ReviewLogEntry } from './types'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

const DAY = 86_400_000
const MINUTE = 60_000
const optimize = (cookie = token, timeZone = 'Europe/Berlin') =>
  call(fsrs.POST, '/api/flashcards/fsrs', { cookie, body: { timeZone } })

/**
 * Lernverlauf, der viel schlechter erinnert wird, als die Standardwerte vorhersagen: nach 1–3 Tagen nur etwa die
 * Hälfte – mit Lernschritten am selben Tag wie im Lernmodus
 */
function poorMemoryLog(cards: Card[]): ReviewLogEntry[] {
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const start = new Date('2026-05-04T09:00:00+02:00').getTime()
  const log: ReviewLogEntry[] = []
  const entry = (card: Card, rating: number, phase: ReviewLogEntry['phase'], reviewedAt: number) =>
    log.push({ cardId: card.id, side: 0, rating: rating as 1 | 2 | 3 | 4, phase, intervalBefore: 0, intervalAfter: 0, durationMs: 4000, reviewedAt })
  cards.forEach((card, i) => {
    let t = start + (i % 20) * DAY + i * MINUTE
    entry(card, 3, 'new', t)
    entry(card, 3, 'learning', t + 10 * MINUTE)
    for (const gap of [1 + (i % 3), 2 + (i % 4)]) {
      t += gap * DAY
      if (rnd() < 0.5) {
        entry(card, 3, 'review', t)
      } else {
        entry(card, 1, 'review', t)
        entry(card, 3, 'relearning', t + 10 * MINUTE)
      }
    }
  })
  return log
}

describe('FSRS-Parameter optimieren', () => {
  it('meldet ohne Bewertungen, dass es zu wenige gibt', async () => {
    const r = await optimize()
    expect(r.status).toBe(200)
    expect(r.data).toMatchObject({ status: 'not_enough', reviews: 0, fsrs: null })
  })

  it('schätzt aus dem Protokoll neue Gewichte, liefert sie mit den Karten und setzt sie zurück', async () => {
    const deck = (await call(decks.POST, '/api/decks', { cookie: token, body: { name: 'Vergesslich', scheduler: 'fsrs' } })).data.deck
    const created = await call(deckCards.POST, '/', {
      cookie: token,
      params: { id: deck.id },
      body: { cards: Array.from({ length: 300 }, (_, i) => ({ type: 'basic', front: `Frage ${i}`, back: `Antwort ${i}` })) },
    })
    expect(created.status).toBe(201)
    const log = poorMemoryLog(created.data.cards as Card[])
    const sent = await call(reviews.POST, '/api/reviews', { cookie: token, body: { reviews: [], log } })
    expect(sent.data.logged).toBe(log.length)

    const r = await optimize()
    expect(r.status).toBe(200)
    const result = r.data as FsrsOptimizeResult
    expect(result.status).toBe('saved')
    expect(result.after!.rmse).toBeLessThan(result.before!.rmse)
    expect(result.reviews).toBe(600)

    const data = (await call(flashcards.GET, '/', { cookie: token })).data as FlashcardData
    expect(data.fsrs?.weights).toHaveLength(19)
    data.fsrs!.weights.forEach((w, i) => {
      expect(w).toBeGreaterThanOrEqual(WEIGHT_CLAMPS[i][0])
      expect(w).toBeLessThanOrEqual(WEIGHT_CLAMPS[i][1])
    })
    // Nach 1–3 Tagen nur die Hälfte erinnert: deutlich kleinere Anfangsstabilität für „Gut“
    expect(data.fsrs!.weights[2]).toBeLessThan(3.173)
    expect(data.fsrs!.metrics.rmse).toBeLessThan(data.fsrs!.defaultMetrics.rmse)

    // Gleich noch einmal: Die gespeicherten Gewichte sind die bisher gültigen – besser wird es nicht
    expect(((await optimize()).data as FsrsOptimizeResult).status).toBe('kept')

    const removed = await call(fsrs.DELETE, '/', { method: 'DELETE', cookie: token })
    expect(removed.data).toEqual({ fsrs: null })
    expect(((await call(flashcards.GET, '/', { cookie: token })).data as FlashcardData).fsrs).toBeNull()
  })

  it('zeigt anderen Konten weder Parameter noch Bewertungen', async () => {
    expect(((await optimize()).data as FsrsOptimizeResult).status).toBe('saved')
    await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'zweites', password: 'Kennwort-Xyz-111' } })
    const other = await loginAs('zweites', 'Kennwort-Xyz-111')
    await call(password.POST, '/', {
      cookie: other,
      body: { currentPassword: 'Kennwort-Xyz-111', newPassword: 'Kennwort-Xyz-222' },
    })
    expect(((await call(flashcards.GET, '/', { cookie: other })).data as FlashcardData).fsrs).toBeNull()
    expect((await optimize(other)).data).toMatchObject({ status: 'not_enough', reviews: 0, fsrs: null })
  })

  it('lehnt unbekannte Zeitzonen ab und rechnet nie zweimal gleichzeitig', async () => {
    expect((await optimize(token, 'Mars/Olympus')).status).toBe(400)
    const [a, b] = await Promise.all([optimize(), optimize()])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(b.status === 409 ? b.data.message : a.data.message).toContain('Optimierung')
  })
})
