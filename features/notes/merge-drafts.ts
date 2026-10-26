// Notizliste vom Server, ergänzt um die lokalen (noch nicht synchronisierten) Entwürfe. Beim Tippen ändert sich bei
// jeder Taste ein Entwurf – Auszug und Tags aus dem ganzen Text werden dann nur für diesen einen neu berechnet, und alle
// Stellen, die die Notizliste brauchen, teilen sich ein Ergebnis.
import { extractTags, makeExcerpt } from '@/shared/markdown/meta'
import { noteText } from './format'
import type { Draft } from './client/sync'
import type { NoteFormat, NoteSummary } from './types'

type Summary = { excerpt: string; tags: string[] }

const summarizeText = (text: string): Summary => ({ excerpt: makeExcerpt(text), tags: extractTags(text) })

/**
 * Funktion, die Serverliste und Entwürfe zusammenführt – mit Gedächtnis: Dieselben Eingaben (Identität) liefern
 * dasselbe Ergebnis, Auszug und Tags eines Entwurfs werden je Fassung nur einmal berechnet. `summarize` ist nur für
 * Tests austauschbar.
 */
export function createDraftMerger(summarize: (text: string) => Summary = summarizeText) {
  let last: { server: NoteSummary[]; drafts: Draft[]; result: NoteSummary[] } | null = null
  // Entwürfe werden bei jeder Änderung ersetzt – ein unveränderter Entwurf ist dasselbe Objekt
  const summaries = new WeakMap<Draft, { format: NoteFormat; summary: Summary }>()
  const summaryOf = (draft: Draft, format: NoteFormat, content: string): Summary => {
    const hit = summaries.get(draft)
    if (hit && hit.format === format) return hit.summary
    const summary = summarize(noteText(format, content))
    summaries.set(draft, { format, summary })
    return summary
  }

  return function mergeDrafts(server: NoteSummary[], drafts: Draft[]): NoteSummary[] {
    if (drafts.length === 0) return server
    if (last && last.server === server && last.drafts === drafts) return last.result
    const byId = new Map(drafts.map((d) => [d.id, d]))
    const result = server.map((n) => {
      const d = byId.get(n.id)
      if (!d) return n
      byId.delete(n.id)
      const format = d.format ?? n.format
      // Im Tresor ist der Inhalt ein Umschlag: kein Auszug, keine Tags
      const summary = d.content !== undefined && !n.vault ? summaryOf(d, format, d.content) : null
      return {
        ...n,
        title: d.title ?? n.title,
        titleEnc: d.titleEnc ?? n.titleEnc,
        folderId: d.folderId !== undefined ? d.folderId : n.folderId,
        format,
        updatedAt: Math.max(n.updatedAt, d.updatedAt),
        ...(summary ?? {}),
      }
    })
    for (const d of byId.values()) {
      if (!d.isNew) continue
      const format = d.format ?? 'markdown'
      const { excerpt, tags } = d.vault ? summarizeText('') : summaryOf(d, format, d.content ?? '')
      result.unshift({
        id: d.id,
        title: d.vault ? d.id : (d.title ?? 'Unbenannt'),
        folderId: d.folderId ?? null,
        format,
        pinned: false,
        version: 0,
        createdAt: d.updatedAt,
        updatedAt: d.updatedAt,
        tags,
        excerpt,
        vault: !!d.vault,
        titleEnc: d.titleEnc ?? null,
      })
    }
    last = { server, drafts, result }
    return result
  }
}
