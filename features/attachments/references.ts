// Welche Dateien eine Notiz einbettet oder verlinkt – danach richtet sich, in welchem Ordner eine Datei steht
import { noteText } from '@/features/notes/format'
import { findWikiLinks, isFileTarget } from '@/shared/markdown/meta'
import type { NoteFormat } from '@/features/notes/types'

// Bilder und Links in formatiertem Text, Seitenlinks aus dem PDF-Viewer in Markdown: /api/files/Skript.pdf#page=3
const FILE_URL_RE = /\/api\/files\/([^\s"'<>#?]+)/g

const fileKey = (name: string) => (name.split('/').pop() ?? name).trim().toLowerCase()

const count = (s: string, ch: string) => s.split(ch).length - 1

/** Dateinamen (klein geschrieben, ohne Pfad), die eine Notiz einbettet oder verlinkt */
export function fileReferences(format: NoteFormat, content: string): Set<string> {
  const names = new Set<string>()
  for (const link of findWikiLinks(noteText(format, content))) {
    if (link.target && isFileTarget(link.target)) names.add(fileKey(link.target))
  }
  for (const m of content.matchAll(FILE_URL_RE)) {
    let raw = m[1]
    // Markdown-Link „[…](/api/files/foto.png)“: Die schließende Klammer gehört nicht zum Namen,
    // die in „Foto (1).png“ schon
    while (raw.endsWith(')') && count(raw, ')') > count(raw, '(')) raw = raw.slice(0, -1)
    try {
      names.add(fileKey(decodeURIComponent(raw)))
    } catch {
      // Ungültig kodiert – kann keine Datei sein
    }
  }
  names.delete('')
  return names
}
