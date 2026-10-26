// Wortzahl und Lesezeit einer Notiz – für die Anzeige beim Schreiben und den Dialog „Informationen“
import { markdownPlainText } from '@/shared/markdown/meta'
import { noteText } from './format'
import type { NoteFormat } from './types'

// Wie Word: „E-Mail“, „don’t“ und „3,14“ sind je ein Wort
const WORD_RE = /[\p{L}\p{N}\p{M}]+(?:(?:[-‐‑'’]|(?<=\p{N})[.,](?=\p{N}))[\p{L}\p{N}\p{M}]+)*/gu
const WORDS_PER_MINUTE = 200
// Bei ganz kurzen Notizen sagt eine Lesezeit nichts
const MIN_WORDS_FOR_READING_TIME = 30

type NoteStats = {
  words: number
  /** Zeichen des Textes wie für Suche und Auszug (bei formatiertem Text ohne HTML) */
  chars: number
  /** Gerundete Minuten bei 200 Wörtern pro Minute; null bei weniger als 30 Wörtern */
  readingMinutes: number | null
}

function countWords(text: string): number {
  return text.match(WORD_RE)?.length ?? 0
}

/** Wörter eines Ausschnitts, z. B. der Markierung im Editor – Markdown ohne Code, Einbettungen und Link-Adressen */
export function wordsIn(format: NoteFormat, text: string): number {
  return countWords(format === 'text' ? text : markdownPlainText(text))
}

export function noteStats(format: NoteFormat, content: string): NoteStats {
  const text = noteText(format, content)
  // Mindmap und Canvas zählen den Text ihrer Punkte bzw. Karten, die selbst wieder Markdown sind
  const words = wordsIn(format, text)
  return {
    words,
    chars: text.length,
    readingMinutes: words < MIN_WORDS_FOR_READING_TIME ? null : Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
  }
}
