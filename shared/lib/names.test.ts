import { describe, expect, it } from 'vitest'
import { sanitizeFilename, sanitizeName, uniqueName, validateName } from './names'

describe('Namen', () => {
  it('validiert und bereinigt Namen', () => {
    expect(validateName('Analysis I')).toBeNull()
    expect(validateName('a/b')).not.toBeNull()
    expect(validateName('[[x]]')).not.toBeNull()
    expect(validateName('.versteckt')).not.toBeNull()
    expect(sanitizeName('Folie 3: Grenzwerte?')).toBe('Folie 3- Grenzwerte-')
    expect(sanitizeName('   ')).toBe('Unbenannt')
    expect(sanitizeFilename('Foto [1].JPG')).toBe('Foto -1-.jpg')
    expect(uniqueName('Notiz', ['notiz', 'Notiz 1'])).toBe('Notiz 2')
    expect(uniqueName('bild', ['bild.png'], '.png')).toBe('bild 1.png')
  })
})
