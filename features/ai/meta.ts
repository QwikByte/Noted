// Titel und Tags für eine Notiz vorschlagen lassen: Anweisung, Ausgabeformat und Prüfung der Antwort (reine Logik).
import { z } from 'zod'
import { normalizeTag, splitFrontmatter } from '@/shared/markdown/meta'
import { sanitizeName, validateName } from '@/shared/lib/names'
import { textPart, type Prompt } from './prompt'
import type { MetaSuggestion } from './types'

/** Für Titel und Tags reicht der Anfang einer langen Notiz */
const MAX_TEXT = 20_000
/** Vorhandene Tags, die Claude zur Auswahl bekommt – die meistgenutzten */
const MAX_KNOWN_TAGS = 300
const MAX_TAGS = 5

export const META_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Vorgeschlagener Titel' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Vorgeschlagene Tags ohne #' },
  },
  required: ['title', 'tags'],
  additionalProperties: false,
}

const META_SYSTEM = `Du schlägst für eine Notiz aus dem Studium einen Titel und Tags vor.
- Titel: kurz und treffend (höchstens 60 Zeichen), in der Sprache der Notiz, ohne Anführungszeichen und ohne die Zeichen \\ / : * ? " < > | # ^ [ ].
- Tags: 1 bis ${MAX_TAGS} Schlagwörter, klein geschrieben, ohne #, mehrere Wörter mit - verbunden, Unterbegriffe mit / (z. B. physik/thermodynamik). Nimm vorhandene Tags der Person, wo sie passen; neue nur, wenn keiner passt. Schlag keine Tags vor, die die Notiz schon hat.`

/** `known`: Tags der Person mit Häufigkeit, `current`: Tags, die die Notiz schon hat */
export function metaPrompt(input: {
  title: string
  content: string
  known: { tag: string; count: number }[]
  current: string[]
}): Prompt {
  const body = (splitFrontmatter(input.content)?.body ?? input.content).trim().slice(0, MAX_TEXT)
  const known = [...input.known]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_KNOWN_TAGS)
    .map((t) => t.tag)
  return {
    system: META_SYSTEM,
    parts: [
      textPart(`Bisheriger Titel: ${input.title.trim() || 'Ohne Titel'}\n\n<notiz>\n${body}\n</notiz>`),
      textPart(`Vorhandene Tags der Person: ${known.length ? known.join(', ') : 'keine'}`),
      textPart(`Tags der Notiz: ${input.current.length ? input.current.join(', ') : 'keine'}`),
    ],
  }
}

const OUTPUT = z.object({ title: z.string(), tags: z.array(z.string()) })

/**
 * Antwort in einen gültigen Titel und neue Tags umwandeln: Unerlaubte Zeichen im Titel werden ersetzt, Tags normalisiert,
 * ohne Doppelte und ohne die, die die Notiz schon hat. null, wenn der Text kein passendes JSON ist.
 */
export function parseMeta(text: string, current: string[]): MetaSuggestion | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = OUTPUT.safeParse(json)
  if (!parsed.success) return null
  const raw = parsed.data.title.trim().replace(/^["'„“”«»]+|["'„“”«»]+$/g, '').trim()
  const title = raw ? sanitizeName(raw, '') : ''
  const has = new Set(current.map((t) => t.toLowerCase()))
  const tags: string[] = []
  for (const t of parsed.data.tags) {
    const tag = normalizeTag(t.replace(/\s+/g, '-'))
    if (!tag || has.has(tag) || tags.includes(tag)) continue
    tags.push(tag)
    if (tags.length === MAX_TAGS) break
  }
  return { title: title && !validateName(title) ? title : null, tags }
}
