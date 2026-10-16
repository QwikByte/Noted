import { describe, expect, it } from 'vitest'
import { applyTemplate, formatDate } from './templates'

describe('Vorlagen', () => {
  it('wendet Vorlagen-Platzhalter an', () => {
    const date = new Date(2026, 9, 12, 9, 5)
    expect(formatDate(date, 'YYYY-MM-DD dddd HH:mm [Uhr]')).toBe('2026-10-12 Montag 09:05 Uhr')
    expect(applyTemplate('{{title}} am {{date}} um {{time}} – {{date:D. MMMM YYYY}}', { title: 'X', date })).toBe(
      'X am 2026-10-12 um 09:05 – 12. Oktober 2026',
    )
  })
})
