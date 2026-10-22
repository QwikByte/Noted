import { describe, expect, it } from 'vitest'
import { cardToMarkdown } from './card-markdown'
import { fitMask, maskName, MIN_MASK_SIZE, moveMask, newMask, occlusionError, resizeMask } from './occlusion'
import { sidesOf } from './study'
import type { Occlusion } from './types'

const mask = (x: number, y: number, w = 0.2, h = 0.1, label = '') => ({ x, y, w, h, label })
const herz: Occlusion = { image: 'herz.png', masks: [mask(0.1, 0.1, 0.2, 0.1, 'Aorta'), mask(0.5, 0.6)], hideAll: false }

describe('Bildverdeckung', () => {
  it('passt Flächen ins Bild ein und rundet sie', () => {
    expect(fitMask(mask(0.9, -0.1, 0.3, 0.123456, '  Linke   Kammer '))).toEqual({ x: 0.7, y: 0, w: 0.3, h: 0.1235, label: 'Linke Kammer' })
    expect(fitMask(mask(0.5, 0.5, 2, 2))).toEqual({ x: 0, y: 0, w: 1, h: 1, label: '' })
  })

  it('verschiebt Flächen und ändert ihre Größe, ohne das Bild zu verlassen', () => {
    const m = mask(0.5, 0.5, 0.2, 0.1, ' Aorta ')
    // Die Beschriftung wird erst beim Speichern bereinigt – sonst verschwände beim Tippen das Leerzeichen am Ende
    expect(moveMask(m, 0.01, -0.05)).toEqual({ x: 0.51, y: 0.45, w: 0.2, h: 0.1, label: ' Aorta ' })
    expect(moveMask(m, 0.5, 0.5)).toMatchObject({ x: 0.8, y: 0.9, w: 0.2, h: 0.1 })
    expect(moveMask(m, -1, -1)).toMatchObject({ x: 0, y: 0 })
    expect(resizeMask(m, 0.05, -0.01)).toEqual({ x: 0.5, y: 0.5, w: 0.25, h: 0.09, label: ' Aorta ' })
    expect(resizeMask(m, 1, 1)).toMatchObject({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
    expect(resizeMask(m, -1, -1)).toMatchObject({ x: 0.5, y: 0.5, w: MIN_MASK_SIZE, h: MIN_MASK_SIZE })
  })

  it('legt Flächen per Knopf in der Mitte an, weitere schräg versetzt', () => {
    const first = newMask([])
    expect(first).toEqual({ x: 0.4, y: 0.44, w: 0.2, h: 0.12, label: '' })
    const second = newMask([first])
    expect(second).toEqual({ x: 0.43, y: 0.47, w: 0.2, h: 0.12, label: '' })
    expect(newMask([second, first])).toMatchObject({ x: 0.46, y: 0.5 })
    // Liegt in der Mitte nichts (mehr), kommt die neue wieder dorthin
    expect(newMask([mask(0, 0), moveMask(first, 0.1, 0)])).toMatchObject({ x: 0.4, y: 0.44 })
    // Am Rand ist Schluss: Die Fläche bleibt im Bild, auch wenn sie dann auf einer anderen liegt
    const crowded = Array.from({ length: 30 }, (_, i) => fitMask(mask(0.4 + i * 0.03, 0.44 + i * 0.03, 0.2, 0.12)))
    expect(newMask(crowded)).toMatchObject({ x: 0.8, y: 0.88, w: 0.2, h: 0.12 })
  })

  it('prüft Bild und Flächen', () => {
    expect(occlusionError(herz)).toBeNull()
    expect(occlusionError({ ...herz, image: '' })).toBe('Bitte wähle ein Bild.')
    expect(occlusionError({ ...herz, image: 'skript.pdf' })).toBe('Bitte wähle ein Bild (z. B. PNG oder JPG).')
    expect(occlusionError({ ...herz, masks: [] })).toBe('Zieh mindestens eine Fläche über das Bild.')
    expect(occlusionError({ ...herz, masks: Array.from({ length: 51 }, () => mask(0, 0)) })).toBe('Höchstens 50 Flächen pro Karte.')
    expect(occlusionError({ ...herz, masks: [mask(0, 0, 0.005, 0.5)] })).toBe('Eine Fläche ist zu klein.')
  })

  it('fragt jede Fläche einzeln ab und exportiert die Beschriftungen als Lücken', () => {
    expect(sidesOf({ type: 'occlusion', front: 'Herz', occlusion: herz })).toEqual([0, 1])
    expect(sidesOf({ type: 'occlusion', front: 'Herz' })).toEqual([])
    expect([maskName(herz, 0), maskName(herz, 1)]).toEqual(['Aorta', 'Fläche 2'])
    expect(cardToMarkdown({ type: 'occlusion', front: 'Herz', back: 'Längsschnitt', options: [], occlusion: herz })).toBe(
      'Herz\n![[herz.png]]\n- ==Aorta==\nLängsschnitt',
    )
  })
})
