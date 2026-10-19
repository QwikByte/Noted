import { describe, expect, it } from 'vitest'
import { filesAt, UNLINKED } from './folders'
import type { Folder, NoteSummary } from '@/features/notes/types'
import type { FileEntry } from './types'

const folder = (id: string, name: string, parentId: string | null = null): Folder => ({
  id,
  name,
  parentId,
  createdAt: 0,
  updatedAt: 0,
})
const note = (id: string, title: string, folderId: string | null): NoteSummary => ({
  id,
  title,
  folderId,
  format: 'markdown',
  pinned: false,
  version: 1,
  createdAt: 0,
  updatedAt: 0,
  tags: [],
  excerpt: '',
})
const file = (id: string, noteIds: string[]): FileEntry => ({
  id,
  filename: `${id}.pdf`,
  mime: 'application/pdf',
  size: 1,
  createdAt: 0,
  noteIds,
})

describe('Dateien in der Ordnerstruktur der Notizen', () => {
  const folders = [
    folder('uni', 'Uni'),
    folder('ana', 'Analysis', 'uni'),
    folder('la', 'Lineare Algebra', 'uni'),
    folder('leer', 'Leer'),
  ]
  const notes = [
    note('root', 'Einkaufsliste', null),
    note('v1', 'Vorlesung 1', 'ana'),
    note('v2', 'Vorlesung 2', 'ana'),
    note('lost', 'Verwaist', 'gibt-es-nicht'),
    note('la1', 'Matrizen', 'la'),
  ]
  const files = [
    file('skript', ['v2', 'v1']),
    file('beide', ['v1', 'la1']),
    file('oben', ['root', 'lost']),
    file('frei', []),
    file('papierkorb', ['geloescht']),
  ]

  it('zeigt auf der obersten Ebene Ordner mit Dateien, Dateien der Notizen dort und zählt Dateien ohne Notiz', () => {
    const top = filesAt(files, notes, folders, null)
    expect(top.folders.map((f) => [f.folder.name, f.count])).toEqual([['Uni', 2]])
    expect(top.files.map((i) => [i.file.id, i.notes.map((n) => n.title)])).toEqual([['oben', ['Einkaufsliste', 'Verwaist']]])
    expect(top.unlinked).toBe(2)
  })

  it('folgt verschachtelten Ordnern; eine Datei in mehreren Ordnern steht in jedem', () => {
    const uni = filesAt(files, notes, folders, 'uni')
    expect(uni.folders.map((f) => [f.folder.name, f.count])).toEqual([
      ['Analysis', 2],
      ['Lineare Algebra', 1],
    ])
    expect(uni.files).toEqual([])
    const ana = filesAt(files, notes, folders, 'ana')
    expect(ana.files.map((i) => [i.file.id, i.notes.map((n) => n.title)])).toEqual([
      ['skript', ['Vorlesung 1', 'Vorlesung 2']],
      ['beide', ['Vorlesung 1']],
    ])
    expect(filesAt(files, notes, folders, 'la').files.map((i) => i.file.id)).toEqual(['beide'])
  })

  it('sammelt Dateien ohne (bekannte) Notiz unter „Ohne Notiz“', () => {
    const unlinked = filesAt(files, notes, folders, UNLINKED)
    expect(unlinked.folders).toEqual([])
    expect(unlinked.files.map((i) => i.file.id)).toEqual(['frei', 'papierkorb'])
  })

  it('kommt mit Ordnerzyklen zurecht', () => {
    const cyclic = [folder('a', 'A', 'b'), folder('b', 'B', 'a')]
    const result = filesAt([file('x', ['n'])], [note('n', 'N', 'a')], cyclic, 'b')
    expect(result.folders.map((f) => f.folder.id)).toEqual(['a'])
  })
})
