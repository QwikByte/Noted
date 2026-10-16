import { describe, expect, it } from 'vitest'
import { safeRedirectPath } from './redirect'

describe('Weiterleitung nach dem Login', () => {
  it('erlaubt nur Pfade innerhalb der App', () => {
    expect(safeRedirectPath('/?n=abc#x')).toBe('/?n=abc#x')
    expect(safeRedirectPath('/settings')).toBe('/settings')
    for (const evil of ['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', 'https://evil.com', 'evil', '/%09/x']) {
      const r = safeRedirectPath(evil)
      expect(new URL(r, 'https://noted.example').origin).toBe('https://noted.example')
    }
    expect(safeRedirectPath(undefined)).toBe('/')
    expect(safeRedirectPath(['/a', '/b'])).toBe('/a')
  })
})
