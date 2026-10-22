// Schmierzettel: Text anhängen, Stände zweier Geräte zusammenführen und einen Notiztitel finden (ohne Browser)
import { makeExcerpt } from '@/shared/markdown/meta'
import { sanitizeName } from '@/shared/lib/names'

/** `b` unter `a` anhängen, durch eine Leerzeile getrennt – ein leerer Teil fällt weg */
export function appendText(a: string, b: string): string {
  if (!b.trim()) return a
  if (!a) return b
  return `${a.trimEnd()}\n\n${b.trimStart()}`
}

/**
 * Stand dieses Geräts (`mine`) mit dem eines anderen (`theirs`) zusammenführen – beide beruhen auf `base`. Hat nur eine
 * Seite geändert, gilt sie; haben beide nur angehängt, kommt erst der Serverstand, dann das hier Angehängte; sonst
 * stehen beide Texte untereinander. Doppelte Zeilen sind möglich, verloren geht nichts.
 */
export function mergeScratchpad(base: string, mine: string, theirs: string): string {
  if (mine === theirs || mine === base) return theirs
  if (theirs === base) return mine
  if (mine.startsWith(base) && theirs.startsWith(base)) return appendText(theirs, mine.slice(base.length))
  return appendText(theirs, mine)
}

/** Titel für eine neue Notiz aus dem Zettel: die erste nicht leere Zeile ohne Markdown-Zeichen */
export function scratchpadNoteTitle(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? ''
  const title = sanitizeName(makeExcerpt(line, 60), 'Schmierzettel')
  // Nur Satzzeichen (z. B. „###“ oder „---“) taugen nicht als Titel
  return /[\p{L}\p{N}]/u.test(title) ? title : 'Schmierzettel'
}
