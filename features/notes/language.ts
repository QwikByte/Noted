// Sprache einer Notiz für Rechtschreibprüfung und Vorlesen: `lang:` im Frontmatter (wie bei Pandoc), sonst die
// Standardsprache aus den Einstellungen
import { splitFrontmatter } from '@/shared/markdown/meta'
import type { NoteFormat } from './types'

/** Sprachen zur Auswahl; andere Kürzel lassen sich frei eingeben */
export const NOTE_LANGUAGES = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'Englisch' },
  { code: 'fr', label: 'Französisch' },
  { code: 'es', label: 'Spanisch' },
  { code: 'it', label: 'Italienisch' },
] as const

export const DEFAULT_LANGUAGE = 'de'

// BCP-47 in der üblichen Form: „en“, „en-GB“, „zh-Hant-TW“
const LANGUAGE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i

export const isLanguageTag = (value: string) => LANGUAGE_RE.test(value)

/** Name einer Sprache für die Anzeige, z. B. „Englisch“ – unbekannte Kürzel bleiben, wie sie sind */
export function languageLabel(code: string): string {
  return NOTE_LANGUAGES.find((l) => l.code === code.toLowerCase())?.label ?? code
}

/** `lang:` aus dem Frontmatter, falls gültig – nur Markdown und Mindmap haben eins */
export function frontmatterLanguage(format: NoteFormat, content: string): string | null {
  if (format !== 'markdown' && format !== 'mindmap') return null
  // Ohne Frontmatter nicht erst nach einem suchen – das läuft bei jedem Tastendruck
  if (!content.startsWith('---')) return null
  const lang = splitFrontmatter(content)?.data?.lang
  return typeof lang === 'string' && isLanguageTag(lang.trim()) ? lang.trim() : null
}

export function noteLanguage(format: NoteFormat, content: string, fallback: string): string {
  return frontmatterLanguage(format, content) ?? fallback
}

const LANG_LINE_RE = /^lang[ \t]*:/

/**
 * `lang:` im Frontmatter setzen (oder mit null entfernen). Ändert nur diese eine Zeile, damit Reihenfolge,
 * Kommentare und Schreibweise der übrigen Properties bleiben; ohne Frontmatter kommt eins an den Anfang.
 */
export function withLanguage(content: string, lang: string | null): string {
  const fm = splitFrontmatter(content)
  if (!fm) return lang ? `---\nlang: ${lang}\n---\n${content}` : content
  const lines = fm.raw ? fm.raw.split(/\r?\n/) : []
  const at = lines.findIndex((l) => LANG_LINE_RE.test(l))
  if (at >= 0) {
    // Eingerückte Folgezeilen gehören noch zum alten Wert (z. B. eine Liste)
    let end = at + 1
    while (end < lines.length && /^[ \t]/.test(lines[end])) end++
    lines.splice(at, end - at, ...(lang ? [`lang: ${lang}`] : []))
  } else if (lang) lines.push(`lang: ${lang}`)
  else return content
  return lines.length ? `---\n${lines.join('\n')}\n---\n${fm.body}` : fm.body
}
