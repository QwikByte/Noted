import { describe, expect, it } from 'vitest'
import { canMoveTo, folderByPath } from './tree'
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
