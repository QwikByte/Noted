// Karteneditor: reine Hilfen ohne Browser- oder Server-Abhängigkeit

/** `snippet` an der Auswahl `at` einsetzen (ersetzt markierten Text) – mit der Cursorposition dahinter */
export function insertAt(text: string, at: { start: number; end: number }, snippet: string): { text: string; cursor: number } {
  const start = Math.max(0, Math.min(at.start, text.length))
  const end = Math.max(start, Math.min(at.end, text.length))
  return { text: text.slice(0, start) + snippet + text.slice(end), cursor: start + snippet.length }
}
