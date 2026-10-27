// Karteikarten mit Claude: Anweisung, Ausgabeformat und Prüfung der Antwort. Reine Logik – den Aufruf macht
// server/cards.ts. Geprüft wird nach denselben Regeln wie beim Speichern (cleanCard im Server der Karteikarten), damit
// jede vorgeschlagene Karte sich auch anlegen lässt.
import { z } from 'zod'
import { clozeCount, normalizeCloze } from '@/features/flashcards/cloze'
import { MAX_CARD_TEXT, MAX_CLOZES, MAX_OPTION_TEXT, MAX_OPTIONS } from '@/features/flashcards/limits'
import { normFront } from '@/features/flashcards/note-sync'
import { splitFrontmatter } from '@/shared/markdown/meta'
import { MAX_AI_CARDS } from './limits'
import type { SuggestedCard } from './types'

const CARD_TYPES = ['basic', 'reversed', 'cloze', 'mc'] as const

/**
 * Was Claude liefern muss (strukturierte Ausgabe), von Hand geschrieben: Aus einem Zod-Schema machte das SDK die
 * Kartentypen nur zu einem Hinweis im Text. Grenzen wie Länge und Anzahl prüft parseSuggestedCards.
 */
export const CARDS_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: CARD_TYPES },
          front: { type: 'string', description: 'Vorderseite: die Frage – bei cloze der Satz mit den Lücken als ==Lücke==' },
          back: {
            type: 'string',
            description: 'Rückseite: die Antwort – bei cloze ein optionaler Zusatz, bei mc eine optionale Erklärung',
          },
          options: {
            type: 'array',
            description: 'Nur bei mc die Antworten, sonst leer',
            items: {
              type: 'object',
              properties: { text: { type: 'string' }, correct: { type: 'boolean' } },
              required: ['text', 'correct'],
              additionalProperties: false,
            },
          },
        },
        required: ['type', 'front', 'back', 'options'],
        additionalProperties: false,
      },
    },
  },
  required: ['cards'],
  additionalProperties: false,
}

// Jede Karte einzeln: Eine unbrauchbare soll nicht die ganze Antwort verwerfen
const OUTPUT = z.object({ cards: z.array(z.unknown()) })
const RAW_CARD = z.object({
  // Laut Anthropic kann ein Aufzählungswert in anderer Groß- und Kleinschreibung zurückkommen
  type: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(CARD_TYPES)),
  front: z.string(),
  back: z.string(),
  options: z.array(z.object({ text: z.string(), correct: z.boolean() })),
})

type RawCard = z.infer<typeof RAW_CARD>

export const CARDS_SYSTEM = `Du erstellst Karteikarten für Studierende aus ihren eigenen Notizen. Gelernt wird mit verteilter Wiederholung (wie in Anki).

Gute Karten:
- Eine Karte fragt genau eine Sache ab: einen Begriff, eine Aussage, einen Zusammenhang, einen Rechenschritt. Lieber mehrere kleine Karten als eine große.
- Die Frage ist ohne die Notiz verständlich und eindeutig. Gib nötigen Zusammenhang in der Frage mit („In der Thermodynamik: …“).
- Die Antwort ist kurz und vollständig. Aufzählungen nur, wenn die Aufzählung selbst gelernt werden soll.
- Nimm, was für eine Prüfung zählt: Definitionen, Sätze, Formeln, Ursachen und Folgen, Unterschiede, aussagekräftige Beispiele. Lass Organisatorisches (Termine, Räume, Literaturlisten) weg.
- Bleib beim Inhalt der Notiz. Ergänze nichts, was dort nicht steht oder sich nicht unmittelbar daraus ergibt.
- Schreib in der Sprache der Notiz. Formeln bleiben LaTeX in $…$ bzw. $$…$$, Code steht in Backticks, Markdown ist erlaubt.

Kartentypen:
- basic: Frage auf der Vorderseite, Antwort auf der Rückseite. Der Normalfall.
- reversed: wird in beide Richtungen abgefragt – nur für Paare, bei denen beide Richtungen sinnvoll sind (Begriff ↔ Übersetzung, Symbol ↔ Bedeutung).
- cloze: Lückentext. Die Vorderseite ist ein Satz, die zu lernenden Wörter stehen als ==Lücke== darin. Jede Lücke wird einzeln abgefragt, nimm höchstens drei pro Karte. Die Rückseite bleibt leer oder enthält einen kurzen Zusatz.
- mc: Multiple Choice, sparsam einsetzen. Vorderseite = Frage, options = 3 bis 5 Antworten, mindestens eine richtig, die falschen plausibel. Rückseite = optionale kurze Erklärung.
Bei basic, reversed und cloze ist options leer.

Erstelle so viele Karten, wie der Stoff hergibt, höchstens ${MAX_AI_CARDS}. Schlag keine Karte vor, die es schon gibt. Wünsche der Person zu den Karten haben Vorrang, solange sie zu diesen Regeln passen.`

/** Inhalt der Anfrage: Notiz ohne Frontmatter, vorhandene Karten der Notiz und die Wünsche */
export function cardsPrompt(input: { title: string; content: string; existing?: string[]; wishes?: string }): string {
  const body = (splitFrontmatter(input.content)?.body ?? input.content).trim()
  const parts = [`Titel der Notiz: ${input.title.trim() || 'Ohne Titel'}`, `<notiz>\n${body}\n</notiz>`]
  // Zum Wiedererkennen reicht der Anfang – lange Vorderseiten würden nur Tokens kosten
  const existing = (input.existing ?? []).map((f) => f.replace(/\s+/g, ' ').trim().slice(0, 300)).filter(Boolean)
  if (existing.length) {
    parts.push(`Diese Karten gibt es zu der Notiz schon (Vorderseiten):\n${existing.map((f) => `- ${f}`).join('\n')}`)
  }
  if (input.wishes?.trim()) parts.push(`Wünsche zu den Karten: ${input.wishes.trim()}`)
  return parts.join('\n\n')
}

function normalizeCard(c: RawCard): SuggestedCard | null {
  const raw = c.front.replace(/\r\n?/g, '\n').trim()
  const front = c.type === 'cloze' ? normalizeCloze(raw) : raw
  const back = c.back.replace(/\r\n?/g, '\n').trim()
  if (!front || front.length > MAX_CARD_TEXT || back.length > MAX_CARD_TEXT) return null
  if (c.type === 'mc') {
    const options = c.options
      .map((o) => ({ text: o.text.replace(/\s*\n\s*/g, ' ').trim(), correct: o.correct }))
      .filter((o) => o.text)
    const valid =
      options.length >= 2 &&
      options.length <= MAX_OPTIONS &&
      options.every((o) => o.text.length <= MAX_OPTION_TEXT) &&
      options.some((o) => o.correct)
    return valid ? { type: 'mc', front, back, options } : null
  }
  if (c.type === 'cloze') {
    const n = clozeCount(front)
    return n >= 1 && n <= MAX_CLOZES ? { type: 'cloze', front, back, options: [] } : null
  }
  return back ? { type: c.type, front, back, options: [] } : null
}

/**
 * Antwort von Claude (JSON-Text) in Karten umwandeln: Unbrauchbare Karten fallen weg, ebenso doppelte Vorderseiten,
 * und es bleiben höchstens MAX_AI_CARDS. null, wenn der Text kein passendes JSON ist.
 */
export function parseSuggestedCards(text: string): SuggestedCard[] | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = OUTPUT.safeParse(json)
  if (!parsed.success) return null
  const out: SuggestedCard[] = []
  const seen = new Set<string>()
  for (const item of parsed.data.cards) {
    const raw = RAW_CARD.safeParse(item)
    const card = raw.success ? normalizeCard(raw.data) : null
    if (!card || seen.has(normFront(card.front))) continue
    seen.add(normFront(card.front))
    out.push(card)
    if (out.length === MAX_AI_CARDS) break
  }
  return out
}
