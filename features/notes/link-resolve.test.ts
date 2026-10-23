import { describe, expect, it } from 'vitest'
import { linkTargets, resolveLinkTarget } from './link-resolve'

// Zwei „Übung 1“ in verschiedenen Fächern, die aus Lineare Algebra zuletzt bearbeitet
const folders: Record<string, string[]> = {
  ana: ['Uni', 'Analysis'],
  la: ['Uni', 'Lineare Algebra'],
  ws: ['WS 25', 'Analysis'],
  ue: ['Übungen'],
}
const la = { id: 'la1', folderId: 'la' }
const ana = { id: 'ana1', folderId: 'ana' }
const root = { id: 'root1', folderId: null }
const foldersOf = (c: { folderId: string | null }) => (c.folderId ? folders[c.folderId] : [])

describe('Wikilinks mit Ordnerpfad auflösen', () => {
  it('öffnet die Notiz im genannten Ordner – unabhängig davon, welche zuletzt bearbeitet wurde', () => {
    expect(resolveLinkTarget('Analysis/Übung 1', [la, ana], foldersOf)).toBe(ana)
    expect(resolveLinkTarget('Uni/Analysis/Übung 1', [la, ana], foldersOf)).toBe(ana)
    expect(resolveLinkTarget('uni/ANALYSIS/übung 1.md', [la, ana], foldersOf)).toBe(ana)
    expect(resolveLinkTarget('Lineare Algebra/Übung 1', [ana, la], foldersOf)).toBe(la)
    // Der Ordner im Link geht dem eigenen Ordner vor
    expect(resolveLinkTarget('Analysis/Übung 1', [la, ana], foldersOf, 'la')).toBe(ana)
    // Der Pfad muss am Ende des Ordnerpfads stehen und ganze Ordnernamen treffen
    expect(linkTargets([la, ana], ['uni'], foldersOf)).toEqual([la, ana])
    expect(linkTargets([la, ana], ['lysis'], foldersOf)).toEqual([la, ana])
  })

  it('fällt auf den Titel zurück, wenn der Ordner nicht (mehr) passt', () => {
    expect(resolveLinkTarget('Alter Ordner/Übung 1', [la, ana], foldersOf)).toBe(la)
    expect(linkTargets([la, ana], ['alter ordner'], foldersOf)).toEqual([la, ana])
  })

  it('ohne Ordner: zuerst die Notiz im eigenen Ordner, sonst die zuletzt bearbeitete', () => {
    expect(resolveLinkTarget('Übung 1', [la, ana], foldersOf, 'ana')).toBe(ana)
    expect(resolveLinkTarget('Übung 1', [la, ana, root], foldersOf, null)).toBe(root)
    expect(resolveLinkTarget('Übung 1', [la, ana], foldersOf, 'ue')).toBe(la)
    expect(resolveLinkTarget('Übung 1', [la, ana], foldersOf)).toBe(la)
    expect(resolveLinkTarget('Übung 1', [], foldersOf)).toBeNull()
    // Mehrdeutig bleibt, was nicht im eigenen Ordner liegt
    expect(linkTargets([la, ana], [], foldersOf, 'ue')).toEqual([la, ana])
    expect(linkTargets([la, ana], [], foldersOf, 'ana')).toEqual([ana])
  })

  it('passt ein Teilpfad zu mehreren, gewinnt der eigene Ordner, sonst die zuletzt bearbeitete', () => {
    const ws = { id: 'ws1', folderId: 'ws' }
    expect(linkTargets([la, ws, ana], ['analysis'], foldersOf)).toEqual([ws, ana])
    expect(resolveLinkTarget('Analysis/Übung 1', [la, ws, ana], foldersOf)).toBe(ws)
    expect(resolveLinkTarget('Analysis/Übung 1', [la, ws, ana], foldersOf, 'ana')).toBe(ana)
  })
})
