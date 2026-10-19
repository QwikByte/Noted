import { describe, expect, it } from 'vitest'
import { generatePassword } from '@/shared/server/crypto'

// Alphabet ohne verwechselbare Zeichen (kein l, I, O, 0, 1)
const GROUP = '[a-km-zA-HJ-NP-Z2-9]'

describe('generatePassword', () => {
  it('liefert 16 Zeichen aus dem lesbaren Alphabet in Vierergruppen', () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePassword()).toMatch(new RegExp(`^${GROUP}{4}(-${GROUP}{4}){3}$`))
    }
    expect(generatePassword(6)).toMatch(new RegExp(`^${GROUP}{4}-${GROUP}{2}$`))
  })

  it('erzeugt jedes Mal ein anderes Passwort', () => {
    const seen = new Set(Array.from({ length: 20 }, () => generatePassword()))
    expect(seen.size).toBe(20)
  })
})
