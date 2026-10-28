// Karteikarten mit Claude: Anweisungen je Quelle (Notiz, PDF, vorhandene Karte), Ausgabeformat und Prüfung der
// Antwort. Reine Logik – den Aufruf macht server/cards.ts. Geprüft wird nach denselben Regeln wie beim Speichern
// (cleanCard im Server der Karteikarten), damit jede vorgeschlagene Karte sich auch anlegen lässt.
import { z } from 'zod'
import { clozeCount, normalizeCloze } from '@/features/flashcards/cloze'
import { MAX_CARD_TEXT, MAX_CLOZES, MAX_OPTION_TEXT, MAX_OPTIONS } from '@/features/flashcards/limits'
import { normFront } from '@/features/flashcards/note-sync'
import { splitFrontmatter } from '@/shared/markdown/meta'
import { MAX_AI_CARDS } from './limits'
import { existingCardsPart, imagePart, textPart, type Prompt, type PromptPart } from './prompt'
import type { CardsRequest, SuggestedCard } from './types'

const CARD_TYPES = ['basic', 'reversed', 'cloze', 'mc'] as const

/** Höchstens so viele kleinere Karten entstehen beim Aufteilen einer Karte */
const MAX_SPLIT = 8
/** … und beim Entschärfen einer Problemkarte */
const MAX_LEECH = 4

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
          page: { type: 'integer', description: 'Seite des PDFs, aus der die Karte stammt – 0, wenn es keine gibt' },
        },
        required: ['type', 'front', 'back', 'options', 'page'],
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
  page: z.number().optional(),
})

type RawCard = z.infer<typeof RAW_CARD>

const CARD_RULES = `Gute Karten:
- Eine Karte fragt genau eine Sache ab: einen Begriff, eine Aussage, einen Zusammenhang, einen Rechenschritt. Lieber mehrere kleine Karten als eine große.
- Die Frage ist ohne die Vorlage verständlich und eindeutig. Gib nötigen Zusammenhang in der Frage mit („In der Thermodynamik: …“).
- Die Antwort ist kurz und vollständig. Aufzählungen nur, wenn die Aufzählung selbst gelernt werden soll.
- Nimm, was für eine Prüfung zählt: Definitionen, Sätze, Formeln, Ursachen und Folgen, Unterschiede, aussagekräftige Beispiele. Lass Organisatorisches (Termine, Räume, Literaturlisten) weg.
- Bleib beim Inhalt der Vorlage. Ergänze nichts, was dort nicht steht oder sich nicht unmittelbar daraus ergibt.
- Schreib in der Sprache der Vorlage. Formeln bleiben LaTeX in $…$ bzw. $$…$$, Code steht in Backticks, Markdown ist erlaubt.

Kartentypen:
- basic: Frage auf der Vorderseite, Antwort auf der Rückseite. Der Normalfall.
- reversed: wird in beide Richtungen abgefragt – nur für Paare, bei denen beide Richtungen sinnvoll sind (Begriff ↔ Übersetzung, Symbol ↔ Bedeutung).
- cloze: Lückentext. Die Vorderseite ist ein Satz, die zu lernenden Wörter stehen als ==Lücke== darin. Jede Lücke wird einzeln abgefragt, nimm höchstens drei pro Karte. Die Rückseite bleibt leer oder enthält einen kurzen Zusatz.
- mc: Multiple Choice, sparsam einsetzen. Vorderseite = Frage, options = 3 bis 5 Antworten, mindestens eine richtig, die falschen plausibel. Rückseite = optionale kurze Erklärung.
Bei basic, reversed und cloze ist options leer.`

const AMOUNT = `Erstelle so viele Karten, wie der Stoff hergibt, höchstens ${MAX_AI_CARDS}. Schlag keine Karte vor, die es schon gibt. Wünsche der Person zu den Karten haben Vorrang, solange sie zu diesen Regeln passen.`

const NOTE_SYSTEM = `Du erstellst Karteikarten für Studierende aus ihren eigenen Notizen. Gelernt wird mit verteilter Wiederholung (wie in Anki).

${CARD_RULES}

Setze page immer auf 0.

${AMOUNT}`

const PDF_SYSTEM = `Du erstellst Karteikarten für Studierende aus ihrem Skript, ihren Folien oder einem anderen PDF. Gelernt wird mit verteilter Wiederholung (wie in Anki). Du bekommst Seiten des PDFs (als Bild und, soweit vorhanden, als Text) und/oder Stellen, die die Person markiert hat. Zu jeder markierten Stelle gehört mindestens eine Karte; ein Kommentar der Person zeigt, worauf es ihr dabei ankommt.

${CARD_RULES}

Gib in page die Seite an, aus der die Karte stammt.

${AMOUNT}`

const IMPROVE_SYSTEM = `Du überarbeitest eine Karteikarte für Studierende, die mit verteilter Wiederholung (wie in Anki) lernen.

${CARD_RULES}

Gib genau eine Karte zurück. Behalte den Inhalt, mach die Frage eindeutig und die Antwort knapp. Wechsle den Kartentyp nur, wenn ein anderer deutlich besser passt. Wünsche der Person haben Vorrang. Setze page auf 0.`

const SPLIT_SYSTEM = `Du teilst eine Karteikarte für Studierende auf, die mit verteilter Wiederholung (wie in Anki) lernen. Die Karte wird oft vergessen – meist, weil sie zu viel auf einmal abfragt.

${CARD_RULES}

Teile sie in 2 bis ${MAX_SPLIT} kleinere Karten auf, die zusammen dasselbe abdecken. Wünsche der Person haben Vorrang. Setze page auf 0.`

const LEECH_SYSTEM = `Du hilfst Studierenden, die mit verteilter Wiederholung (wie in Anki) lernen, bei einer Problemkarte: Sie wurde schon oft vergessen.

${CARD_RULES}

Mach die Karte leichter merkbar. Ist sie zu umfangreich, teile sie in bis zu ${MAX_LEECH} kleinere Karten, die zusammen dasselbe abdecken; ist sie unklar, formuliere sie eindeutig – dann genügt eine Karte. Wo es hilft, ergänze am Ende der Rückseite eine kurze Merkhilfe (Eselsbrücke, Bild, Vergleich) als eigene Zeile „Merkhilfe: …“. Die wichtigste Karte steht zuerst. Wünsche der Person haben Vorrang. Setze page auf 0.`

const CARD_SYSTEMS = { improve: IMPROVE_SYSTEM, split: SPLIT_SYSTEM, leech: LEECH_SYSTEM }
const CARD_MAX = { improve: 1, split: MAX_SPLIT, leech: MAX_LEECH }

const wishesPart = (wishes: string | undefined): PromptPart[] =>
  wishes?.trim() ? [textPart(`Wünsche zu den Karten: ${wishes.trim()}`)] : []

const cardText = (card: { type: string; front: string; back: string; options: { text: string; correct: boolean }[] }) =>
  [
    `Typ: ${card.type}`,
    `Vorderseite:\n${card.front.trim()}`,
    card.back.trim() ? `Rückseite:\n${card.back.trim()}` : '',
    card.options.length ? `Antworten:\n${card.options.map((o) => `- [${o.correct ? 'x' : ' '}] ${o.text}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

/** Anfrage für Karten aus einer Notiz, einem PDF oder einer vorhandenen Karte */
export function cardsPrompt({ source, existing, wishes }: CardsRequest): Prompt {
  if (source.kind === 'card') {
    return {
      system: CARD_SYSTEMS[source.mode],
      parts: [textPart(`<karte>\n${cardText(source.card)}\n</karte>`), ...wishesPart(wishes)],
    }
  }
  if (source.kind === 'note' || source.kind === 'text') {
    const body = (splitFrontmatter(source.content)?.body ?? source.content).trim()
    return {
      system: NOTE_SYSTEM,
      parts: [
        textPart(`Titel der Notiz: ${source.title.trim() || 'Ohne Titel'}\n\n<notiz>\n${body}\n</notiz>`),
        ...existingCardsPart(existing, 'Diese Karten gibt es zu der Notiz schon (Vorderseiten):'),
        ...wishesPart(wishes),
      ],
    }
  }
  const parts: PromptPart[] = [textPart(`PDF: ${source.file}`)]
  for (const p of source.pages) {
    // Bild vor dem Text: So liest Claude die Seite zuerst als Ganzes
    parts.push(textPart(`Seite ${p.page}:`))
    if (p.image) parts.push(imagePart(p.image))
    if (p.text.trim()) parts.push(textPart(`<text seite="${p.page}">\n${p.text.trim()}\n</text>`))
  }
  if (source.marks.length) parts.push(textPart('Markierte Stellen:'))
  for (const m of source.marks) {
    if (m.image) parts.push(imagePart(m.image))
    const quote = m.quote.trim() ? `Zitat: ${m.quote.trim()}` : 'Bereich (siehe Bild)'
    const comment = m.comment.trim() ? `\nKommentar: ${m.comment.trim()}` : ''
    parts.push(textPart(`<markierung seite="${m.page}">\n${quote}${comment}\n</markierung>`))
  }
  parts.push(...existingCardsPart(existing, 'Diese Karten gibt es dazu schon (Vorderseiten):'), ...wishesPart(wishes))
  return { system: PDF_SYSTEM, parts }
}

function normalizeCard(c: RawCard, pages: ReadonlySet<number>): SuggestedCard | null {
  const raw = c.front.replace(/\r\n?/g, '\n').trim()
  const front = c.type === 'cloze' ? normalizeCloze(raw) : raw
  const back = c.back.replace(/\r\n?/g, '\n').trim()
  // Nur Seiten, die Claude auch bekommen hat – eine erfundene Seitenzahl führte ins Leere
  const page = c.page !== undefined && pages.has(c.page) ? c.page : null
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
    return valid ? { type: 'mc', front, back, options, page } : null
  }
  if (c.type === 'cloze') {
    const n = clozeCount(front)
    return n >= 1 && n <= MAX_CLOZES ? { type: 'cloze', front, back, options: [], page } : null
  }
  return back ? { type: c.type, front, back, options: [], page } : null
}

/** Eine von Claude vorgeschlagene Karte prüfen (z. B. aus dem Chat) – null, wenn sie sich so nicht anlegen ließe */
export function cleanSuggestedCard(raw: unknown): SuggestedCard | null {
  const parsed = RAW_CARD.safeParse(raw)
  return parsed.success ? normalizeCard(parsed.data, new Set()) : null
}

/** Wie viele Karten aus einer Antwort höchstens übernommen werden und auf welche Seiten sie sich beziehen dürfen */
export function cardsLimits(request: CardsRequest): { max: number; pages: Set<number> } {
  const { source } = request
  if (source.kind === 'card') return { max: CARD_MAX[source.mode], pages: new Set() }
  if (source.kind === 'note' || source.kind === 'text') return { max: MAX_AI_CARDS, pages: new Set() }
  return { max: MAX_AI_CARDS, pages: new Set([...source.pages, ...source.marks].map((p) => p.page)) }
}

/**
 * Antwort von Claude (JSON-Text) in Karten umwandeln: Unbrauchbare Karten fallen weg, ebenso doppelte Vorderseiten,
 * und es bleiben höchstens `max`. null, wenn der Text kein passendes JSON ist.
 */
export function parseSuggestedCards(
  text: string,
  { max = MAX_AI_CARDS, pages = new Set<number>() }: { max?: number; pages?: ReadonlySet<number> } = {},
): SuggestedCard[] | null {
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
    const card = raw.success ? normalizeCard(raw.data, pages) : null
    if (!card || seen.has(normFront(card.front))) continue
    seen.add(normFront(card.front))
    out.push(card)
    if (out.length === max) break
  }
  return out
}
