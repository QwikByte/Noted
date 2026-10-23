import { describe, expect, it } from 'vitest'
import { pdfKeyAction } from './keyboard'

const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
})

describe('Tastatur im PDF-Viewer', () => {
  it('Suche: Strg/⌘ + F öffnet, F3 und Umschalt + F3 springen – auch aus dem Suchfeld', () => {
    expect(pdfKeyAction(key('f', { ctrl: true }))).toBe('find')
    expect(pdfKeyAction(key('F', { meta: true }), { inField: true })).toBe('find')
    expect(pdfKeyAction(key('F3'), { inField: true })).toBe('findNext')
    expect(pdfKeyAction(key('F3', { shift: true }))).toBe('findPrevious')
    expect(pdfKeyAction(key('f', { ctrl: true, shift: true }))).toBeNull()
  })

  it('blättert und zoomt ohne Strg/⌘ – Strg/⌘ + Plus bleibt dem Browser', () => {
    expect(pdfKeyAction(key('ArrowRight'))).toBe('nextPage')
    expect(pdfKeyAction(key('ArrowLeft'))).toBe('prevPage')
    expect(pdfKeyAction(key('Home'))).toBe('firstPage')
    expect(pdfKeyAction(key('End'))).toBe('lastPage')
    expect(pdfKeyAction(key('+'))).toBe('zoomIn')
    expect(pdfKeyAction(key('+', { shift: true }))).toBe('zoomIn')
    expect(pdfKeyAction(key('-'))).toBe('zoomOut')
    expect(pdfKeyAction(key('0'))).toBe('fitWidth')
    expect(pdfKeyAction(key('+', { ctrl: true }))).toBeNull()
    expect(pdfKeyAction(key('G'))).toBe('pageInput')
  })

  it('markiert mit Strg/⌘ + Umschalt + H und schließt mit Esc', () => {
    expect(pdfKeyAction(key('H', { ctrl: true, shift: true }))).toBe('highlight')
    expect(pdfKeyAction(key('h', { meta: true, shift: true }))).toBe('highlight')
    expect(pdfKeyAction(key('Escape'))).toBe('escape')
  })

  it('lässt Eingabefeldern ihre Tasten und scrollt seitwärts, wenn die Seite breiter ist', () => {
    for (const k of ['ArrowLeft', 'ArrowRight', 'Home', 'End', '+', '-', '0', 'g', 'Escape']) {
      expect(pdfKeyAction(key(k), { inField: true }), k).toBeNull()
    }
    expect(pdfKeyAction(key('H', { ctrl: true, shift: true }), { inField: true })).toBeNull()
    expect(pdfKeyAction(key('ArrowRight'), { scrollsSideways: true })).toBeNull()
    expect(pdfKeyAction(key('End'), { scrollsSideways: true })).toBe('lastPage')
    expect(pdfKeyAction(key('ArrowRight', { alt: true }))).toBeNull()
  })
})
