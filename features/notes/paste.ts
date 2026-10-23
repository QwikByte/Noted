// Einfügen im Markdown-Editor: reine Hilfen ohne DOM

/** Steht in der Zwischenablage nur eine Adresse? Dann wird markierter Text damit zum Link. */
export function singleUrl(text: string): string | null {
  const t = text.trim()
  return /^https?:\/\/\S+$/i.test(t) ? t : null
}

/** Aus HTML umgewandeltes Markdown aufräumen: geschützte Leerzeichen, mehrere Leerzeilen, Leerzeilen am Rand */
export function cleanPastedMarkdown(md: string): string {
  return md
    .replace(/ /g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
}

/**
 * HTML aus Noted selbst (Lesemodus): Formeln, Wikilinks und Callouts kämen aus dem gerenderten HTML nicht als Markdown
 * zurück – dann lieber den Text.
 */
export function isNotedHtml(html: string): boolean {
  return /\bdata-note-id=|class="[^"]*\b(katex|wikilink|callout|embed-note|embed-file)\b/.test(html)
}
