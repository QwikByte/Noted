import { describe, expect, it, vi } from 'vitest'
import { extractTags, makeExcerpt } from '@/shared/markdown/meta'
import { createDraftMerger } from './merge-drafts'
import type { Draft } from './client/sync'
import type { NoteSummary } from './types'

const note = (id: string, extra: Partial<NoteSummary> = {}): NoteSummary => ({
  id,
  title: id,
  folderId: null,
  format: 'markdown',
  pinned: false,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  tags: [],
  excerpt: '',
  vault: false,
  titleEnc: null,
  ...extra,
})

const draft = (id: string, content: string, extra: Partial<Draft> = {}): Draft => ({
  id,
  isNew: false,
  content,
  baseVersion: 1,
  rev: 1,
  updatedAt: 5,
  ...extra,
})

/** Zählt, wie oft Auszug und Tags berechnet werden */
function counted() {
  const summarize = vi.fn((text: string) => ({ excerpt: makeExcerpt(text), tags: extractTags(text) }))
  return { merge: createDraftMerger(summarize), summarize }
}

describe('createDraftMerger', () => {
  const server = [note('a'), note('b'), note('c', { vault: true })]

  it('übernimmt Titel, Ordner, Auszug und Tags aus den Entwürfen – neue Notizen zuerst', () => {
    const { merge } = counted()
    const result = merge(server, [
      draft('a', '# Analysis\n\nFolgen #mathe', { title: 'Analysis I', folderId: 'f1' }),
      draft('neu', 'Notiz von unterwegs #uni', { isNew: true, title: 'Unterwegs' }),
    ])
    expect(result.map((n) => n.id)).toEqual(['neu', 'a', 'b', 'c'])
    expect(result[0]).toMatchObject({ title: 'Unterwegs', tags: ['uni'], version: 0 })
    expect(result[1]).toMatchObject({ title: 'Analysis I', folderId: 'f1', tags: ['mathe'], updatedAt: 5 })
    expect(result[1].excerpt).toContain('Folgen')
    expect(result[2]).toBe(server[1])
  })

  it('liest im Tresor keinen Auszug und keine Tags aus dem Umschlag', () => {
    const { merge, summarize } = counted()
    const [, , c] = merge(server, [draft('c', 'noted-vault:v1:…', { titleEnc: 'umschlag' })])
    expect(c).toMatchObject({ tags: [], excerpt: '', titleEnc: 'umschlag' })
    expect(summarize).not.toHaveBeenCalled()
  })

  it('gleiche Eingaben liefern dasselbe Ergebnis, ein geänderter Entwurf berechnet nur sich neu', () => {
    const { merge, summarize } = counted()
    const a = draft('a', 'Text #eins')
    const b = draft('b', 'Text #zwei')
    const drafts = [a, b]
    const first = merge(server, drafts)
    expect(summarize).toHaveBeenCalledTimes(2)
    // Mehrere Hooks, dieselben Eingaben: ein Ergebnis, keine neue Rechnung
    expect(merge(server, drafts)).toBe(first)
    expect(summarize).toHaveBeenCalledTimes(2)

    // Getippt in a: nur a neu
    const a2 = { ...a, content: 'Text #eins #drei', rev: 2 }
    const typed = merge(server, [a2, b])
    expect(typed).not.toBe(first)
    expect(summarize).toHaveBeenCalledTimes(3)
    expect(typed.find((n) => n.id === 'a')?.tags).toEqual(['drei', 'eins'])
    expect(typed.find((n) => n.id === 'b')?.tags).toEqual(['zwei'])

    // Neue Serverliste, Entwürfe unverändert: neu zusammengeführt, aber ohne neue Rechnung
    const reloaded = merge([...server], [a2, b])
    expect(reloaded).not.toBe(typed)
    expect(reloaded.find((n) => n.id === 'a')?.tags).toEqual(['drei', 'eins'])
    expect(summarize).toHaveBeenCalledTimes(3)
  })

  it('ohne Entwürfe kommt die Serverliste selbst zurück', () => {
    const { merge } = counted()
    expect(merge(server, [])).toBe(server)
  })
})
