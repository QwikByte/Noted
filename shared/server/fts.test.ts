import { describe, expect, it } from 'vitest'
import { buildExclusionQuery, buildFtsQuery } from './fts'

describe('FTS5-Abfrage', () => {
  it('setzt Wörter und Phrasen als Präfix in Anführungszeichen und Ausschlüsse mit NOT', () => {
    expect(buildFtsQuery({ terms: ['ableitung'], phrases: ['Satz von Bay'], excluded: ['physik', 'lineare algebra'] })).toBe(
      '"ableitung"* "Satz von Bay"* NOT "physik"* NOT "lineare algebra"*',
    )
  })

  it('verdoppelt Anführungszeichen, damit keine FTS-Syntax eingeschleust werden kann', () => {
    expect(buildFtsQuery({ terms: ['a"OR"b'], phrases: [], excluded: [] })).toBe('"a""OR""b"*')
  })

  it('kann ohne Wort oder Phrase nichts suchen', () => {
    expect(buildFtsQuery({ terms: [], phrases: [], excluded: ['klausur'] })).toBeNull()
    expect(buildExclusionQuery(['klausur', 'alt'])).toBe('"klausur"* OR "alt"*')
    expect(buildExclusionQuery([])).toBeNull()
  })
})
