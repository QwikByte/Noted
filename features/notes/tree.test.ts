import { describe, expect, it } from 'vitest'
import { canMoveTo, folderByPath, parseNoteOrder, sortNotes } from './tree'
import type { Folder, NoteSummary } from './types'

const folder = (id: string, parentId: string | null = null): Folder => ({
  id,
  name: id,
  parentId,
  createdAt: 0,
  updatedAt: 0,
  vault: false,
  nameEnc: null,
})
const note = (id: string, folderId: string | null): NoteSummary => ({
  id,
  folderId,
  title: id,
  format: 'markdown',
  pinned: false,
  version: 1,
  createdAt: 0,
  updatedAt: 0,
  tags: [],
  excerpt: '',
  vault: false,
  titleEnc: null,
})

describe('Verschieben per Drag & Drop', () => {
  const folders = [folder('uni'), folder('ana', 'uni'), folder('ueb', 'ana'), folder('privat')]
  const notes = [note('v1', 'ana'), note('oben', null), note('v2', 'ana')]

  it('verschiebt Notizen in andere Ordner, aber nicht dorthin, wo sie schon liegen', () => {
    expect(canMoveTo({ kind: 'notes', ids: ['v1'] }, 'privat', notes, folders)).toBe(true)
    expect(canMoveTo({ kind: 'notes', ids: ['v1'] }, null, notes, folders)).toBe(true)
    expect(canMoveTo({ kind: 'notes', ids: ['v1'] }, 'ana', notes, folders)).toBe(false)
    expect(canMoveTo({ kind: 'notes', ids: ['oben'] }, null, notes, folders)).toBe(false)
    expect(canMoveTo({ kind: 'notes', ids: ['unbekannt'] }, 'uni', notes, folders)).toBe(false)
    expect(canMoveTo({ kind: 'notes', ids: ['v1'] }, 'geloescht', notes, folders)).toBe(false)
  })

  it('verschiebt mehrere Notizen, sobald mindestens eine noch nicht im Ziel liegt', () => {
    expect(canMoveTo({ kind: 'notes', ids: ['v1', 'oben'] }, 'ana', notes, folders)).toBe(true)
    expect(canMoveTo({ kind: 'notes', ids: ['v1', 'oben'] }, 'privat', notes, folders)).toBe(true)
    expect(canMoveTo({ kind: 'notes', ids: ['v1', 'v2'] }, 'ana', notes, folders)).toBe(false)
    expect(canMoveTo({ kind: 'notes', ids: ['v1', 'oben'] }, 'geloescht', notes, folders)).toBe(false)
    expect(canMoveTo({ kind: 'notes', ids: ['unbekannt', 'auch-unbekannt'] }, 'uni', notes, folders)).toBe(false)
  })

  it('verschiebt keinen Ordner in sich selbst oder seine Unterordner', () => {
    expect(canMoveTo({ kind: 'folder', id: 'ana' }, 'privat', notes, folders)).toBe(true)
    expect(canMoveTo({ kind: 'folder', id: 'ana' }, null, notes, folders)).toBe(true)
    expect(canMoveTo({ kind: 'folder', id: 'ueb' }, 'uni', notes, folders)).toBe(true)
    expect(canMoveTo({ kind: 'folder', id: 'ana' }, 'uni', notes, folders)).toBe(false)
    expect(canMoveTo({ kind: 'folder', id: 'uni' }, null, notes, folders)).toBe(false)
    expect(canMoveTo({ kind: 'folder', id: 'uni' }, 'uni', notes, folders)).toBe(false)
    expect(canMoveTo({ kind: 'folder', id: 'uni' }, 'ueb', notes, folders)).toBe(false)
  })

  it('verschiebt Ordner nicht über die Grenze des Tresors und dessen Wurzelordner gar nicht', () => {
    const vaultFolder = (id: string, parentId: string | null): Folder => ({
      ...folder(id, parentId),
      vault: true,
      nameEnc: parentId ? 'nv1.x' : null,
    })
    const all = [...folders, vaultFolder('tresor', null), vaultFolder('geheim', 'tresor'), vaultFolder('tief', 'tresor')]
    expect(canMoveTo({ kind: 'folder', id: 'geheim' }, 'tief', notes, all)).toBe(true)
    expect(canMoveTo({ kind: 'folder', id: 'geheim' }, 'uni', notes, all)).toBe(false)
    expect(canMoveTo({ kind: 'folder', id: 'geheim' }, null, notes, all)).toBe(false)
    expect(canMoveTo({ kind: 'folder', id: 'privat' }, 'tresor', notes, all)).toBe(false)
    expect(canMoveTo({ kind: 'folder', id: 'tresor' }, 'uni', notes, all)).toBe(false)
  })
})

describe('Ordner zu einem Pfad', () => {
  const folders = [
    folder('Physik'),
    { ...folder('w1', 'Physik'), name: 'Wellen' },
    folder('Mathe'),
    { ...folder('w2', 'Mathe'), name: 'Wellen' },
    { ...folder('Tresor'), vault: true },
  ]

  it('sucht ab der obersten Ebene, Groß-/Kleinschreibung egal', () => {
    expect(folderByPath(folders, ['physik'])).toBe(folders[0])
    expect(folderByPath(folders, ['Mathe', 'WELLEN'])).toBe(folders[3])
  })

  it('findet nichts bei unbekanntem Pfad, Unterordnern ohne Pfad und im Tresor', () => {
    expect(folderByPath(folders, ['Chemie'])).toBeNull()
    expect(folderByPath(folders, ['Wellen'])).toBeNull()
    expect(folderByPath(folders, ['Tresor'])).toBeNull()
  })
})

describe('Sortierung der Notizlisten', () => {
  const at = (title: string, createdAt: number, updatedAt: number) => ({ ...note(title, null), createdAt, updatedAt })
  const notes = [at('Übung 10', 3, 30), at('Übung 2', 1, 50), at('Analysis', 2, 50), at('Ölpreis', 4, 10)]
  const titles = (list: NoteSummary[]) => list.map((n) => n.title)

  it('sortiert nach Name mit Zahlen und Umlauten wie im Deutschen', () => {
    expect(titles(sortNotes(notes, 'name:asc'))).toEqual(['Analysis', 'Ölpreis', 'Übung 2', 'Übung 10'])
    expect(titles(sortNotes(notes, 'name:desc'))).toEqual(['Übung 10', 'Übung 2', 'Ölpreis', 'Analysis'])
  })

  it('sortiert nach Bearbeitung und bei gleicher Zeit nach Name', () => {
    expect(titles(sortNotes(notes, 'updated:desc'))).toEqual(['Analysis', 'Übung 2', 'Übung 10', 'Ölpreis'])
    expect(titles(sortNotes(notes, 'updated:asc'))).toEqual(['Ölpreis', 'Übung 10', 'Analysis', 'Übung 2'])
  })

  it('sortiert nach Erstellung', () => {
    expect(titles(sortNotes(notes, 'created:desc'))).toEqual(['Ölpreis', 'Übung 10', 'Analysis', 'Übung 2'])
    expect(titles(sortNotes(notes, 'created:asc'))).toEqual(['Übung 2', 'Analysis', 'Übung 10', 'Ölpreis'])
  })

  it('lässt die Eingabe unverändert', () => {
    const before = titles(notes)
    sortNotes(notes, 'name:asc')
    expect(titles(notes)).toEqual(before)
  })

  it('nimmt für unbekannte gespeicherte Werte den Standard', () => {
    expect(parseNoteOrder('created:asc', 'name:asc')).toBe('created:asc')
    expect(parseNoteOrder('größe:asc', 'name:asc')).toBe('name:asc')
    expect(parseNoteOrder('', 'updated:desc')).toBe('updated:desc')
  })
})
