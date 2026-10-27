import { describe, expect, it } from 'vitest'
import { metaPrompt, parseMeta } from './meta'

describe('Titel und Tags', () => {
  it('schickt die Notiz, die meistgenutzten Tags des Kontos und die der Notiz', () => {
    const { parts } = metaPrompt({
      title: 'Unbenannt',
      content: '---\ntags: [physik]\n---\nEnergie bleibt erhalten.',
      known: [
        { tag: 'chemie', count: 2 },
        { tag: 'physik', count: 9 },
      ],
      current: ['physik'],
    })
    expect(parts.map((p) => (p.kind === 'text' ? p.text : ''))).toEqual([
      'Bisheriger Titel: Unbenannt\n\n<notiz>\nEnergie bleibt erhalten.\n</notiz>',
      'Vorhandene Tags der Person: physik, chemie',
      'Tags der Notiz: physik',
    ])
  })

  it('macht aus der Antwort einen gültigen Titel und neue, normalisierte Tags', () => {
    const answer = JSON.stringify({
      title: '„Thermodynamik: Hauptsätze“',
      tags: ['Physik', '#thermo dynamik', 'physik', '123', 'a', 'b', 'c', 'd', 'e'],
    })
    expect(parseMeta(answer, ['physik'])).toEqual({ title: 'Thermodynamik- Hauptsätze', tags: ['thermo-dynamik', 'a', 'b', 'c', 'd'] })
  })

  it('liefert ohne brauchbaren Titel nur die Tags und lehnt anderes ab', () => {
    expect(parseMeta(JSON.stringify({ title: ' "" ', tags: [] }), [])).toEqual({ title: null, tags: [] })
    expect(parseMeta('kein JSON', [])).toBeNull()
    expect(parseMeta(JSON.stringify({ titel: 'x' }), [])).toBeNull()
  })
})
