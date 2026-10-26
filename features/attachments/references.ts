// Welche Dateien eine Notiz einbettet oder verlinkt – danach richtet sich, in welchem Ordner eine Datei steht
import { noteText } from '@/features/notes/format'
import { findWikiLinks, isFileTarget } from '@/shared/markdown/meta'
import { pdfPageFromSubpath } from '@/shared/markdown/syntax'
import type { NoteFormat } from '@/features/notes/types'

// Bilder und Links in formatiertem Text, Seitenlinks aus dem PDF-Viewer in Markdown: /api/files/Skript.pdf#page=3
const FILE_URL_RE = /\/api\/files\/([^\s"'<>#?]+)(?:\?[^\s"'<>#]*)?(?:#([^\s"'<>]*))?/g

const fileKey = (name: string) => (name.split('/').pop() ?? name).trim().toLowerCase()

const count = (s: string, ch: string) => s.split(ch).length - 1

/**
 * Dateien, die eine Notiz einbettet oder verlinkt (Name klein geschrieben, ohne Pfad), je mit den zitierten Seiten –
 * `null` steht für die ganze Datei (Einbettung oder Link ohne Seite)
 */
export function filePageReferences(format: NoteFormat, content: string): Map<string, Set<number | null>> {
  const refs = new Map<string, Set<number | null>>()
  const add = (name: string, subpath: string | null | undefined) => {
    if (!name) return
    const pages = refs.get(name) ?? new Set()
    pages.add(subpath ? pdfPageFromSubpath(subpath) : null)
    refs.set(name, pages)
  }
  for (const link of findWikiLinks(noteText(format, content))) {
    if (link.target && isFileTarget(link.target)) add(fileKey(link.target), link.heading)
  }
  for (const m of content.matchAll(FILE_URL_RE)) {
    let raw = m[1]
    // Markdown-Link „[…](/api/files/foto.png)“: Die schließende Klammer gehört nicht zum Namen,
    // die in „Foto (1).png“ schon
    while (raw.endsWith(')') && count(raw, ')') > count(raw, '(')) raw = raw.slice(0, -1)
    try {
      add(fileKey(decodeURIComponent(raw)), m[2])
    } catch {
      // Ungültig kodiert – kann keine Datei sein
    }
  }
  return refs
}

/** Dateinamen (klein geschrieben, ohne Pfad), die eine Notiz einbettet oder verlinkt */
export function fileReferences(format: NoteFormat, content: string): Set<string> {
  return new Set(filePageReferences(format, content).keys())
}
