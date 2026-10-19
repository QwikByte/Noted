import { describe, expect, it } from 'vitest'
import { canMoveTo } from './tree'
import type { Folder, NoteSummary } from './types'

const folder = (id: string, parentId: string | null = null): Folder => ({ id, name: id, parentId, createdAt: 0, updatedAt: 0 })
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
})

describe('Verschieben per Drag & Drop', () => {
  const folders = [folder('uni'), folder('ana', 'uni'), folder('ueb', 'ana'), folder('privat')]
  const notes = [note('v1', 'ana'), note('oben', null)]

  it('verschiebt Notizen in andere Ordner, aber nicht dorthin, wo sie schon liegen', () => {
    expect(canMoveTo({ kind: 'note', id: 'v1' }, 'privat', notes, folders)).toBe(true)
    expect(canMoveTo({ kind: 'note', id: 'v1' }, null, notes, folders)).toBe(true)
    expect(canMoveTo({ kind: 'note', id: 'v1' }, 'ana', notes, folders)).toBe(false)
    expect(canMoveTo({ kind: 'note', id: 'oben' }, null, notes, folders)).toBe(false)
    expect(canMoveTo({ kind: 'note', id: 'unbekannt' }, 'uni', notes, folders)).toBe(false)
    expect(canMoveTo({ kind: 'note', id: 'v1' }, 'geloescht', notes, folders)).toBe(false)
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
})
