import { describe, expect, it } from 'vitest'
import { inTurns } from './in-turns'

describe('inTurns', () => {
  it('führt höchstens so viele Aufgaben gleichzeitig aus, auch wenn eine scheitert', async () => {
    const inTurn = inTurns(2)
    let running = 0
    let most = 0
    const task = (fail = false) =>
      inTurn(async () => {
        running++
        most = Math.max(most, running)
        await new Promise((resolve) => setTimeout(resolve, 5))
        running--
        if (fail) throw new Error('kaputt')
        return 'fertig'
      })
    const results = await Promise.allSettled([task(), task(true), task(), task(), task()])
    expect(most).toBe(2)
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled'])
    // Danach ist wieder Platz
    expect(await task()).toBe('fertig')
  })
})
