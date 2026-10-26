import { describe, expect, it } from 'vitest'
import { isHorizontal, swipeDecision } from './swipe'

describe('swipeDecision', () => {
  it('nach links „left“, nach rechts „right“ – ab 30 % der Kartenbreite', () => {
    expect(swipeDecision(-120, 5, 400)).toBe('left')
    expect(swipeDecision(120, -5, 400)).toBe('right')
    expect(swipeDecision(119, 0, 400)).toBeNull()
  })

  it('auf schmalen Karten mindestens 60 px', () => {
    expect(swipeDecision(59, 0, 100)).toBeNull()
    expect(swipeDecision(-60, 0, 100)).toBe('left')
  })

  it('senkrechtes Scrollen löst nichts aus – waagerecht muss doppelt so weit sein', () => {
    expect(swipeDecision(150, 80, 300)).toBeNull()
    expect(swipeDecision(150, 74, 300)).toBe('right')
    expect(swipeDecision(0, 400, 300)).toBeNull()
  })

  it('folgt dem Finger nur bei waagerechter Bewegung', () => {
    expect(isHorizontal(30, 10)).toBe(true)
    expect(isHorizontal(10, 30)).toBe(false)
    expect(isHorizontal(0, 0)).toBe(false)
  })
})
