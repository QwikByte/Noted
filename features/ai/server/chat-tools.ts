import 'server-only'
// Werkzeuge des KI-Chats: lesen Notizen, Dateien, Karteikarten, Lernstand und Termine des Kontos – nie aus dem Tresor
// und nie fremde. Antworten sind knapper Text für Claude; Fehler sind Meldungen, mit denen Claude weiterarbeiten kann.
import type { BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages'
import { z } from 'zod'
import { attachmentPageTexts, searchAttachments } from '@/features/attachments/server/index'
import { listAttachments, readAttachmentData } from '@/features/attachments/server/attachments'
import { addDays, localDate, longDate, shortDate, timeOf, weekdayName } from '@/features/calendar/dates'
import { occurrences } from '@/features/calendar/event'
import { listEvents } from '@/features/calendar/server/events'
import { cardMatches } from '@/features/flashcards/browse'
import { daysUntil, examsByDeck, nextExam } from '@/features/flashcards/exam'
import { getFlashcardData } from '@/features/flashcards/server/flashcards'
import { endOfDay } from '@/features/flashcards/srs'
import { cardLapses, deckCounts, isProblemCard, reviewKey, sidesOf, stateMap } from '@/features/flashcards/study'
import { listFocusSessions } from '@/features/focus/server/sessions'
import { folderPathMap, getNote, listNotes, searchNotes } from '@/features/notes/server/notes'
import { noteText } from '@/features/notes/format'
import { ApiError } from '@/shared/server/http'
import { SNIPPET_END, SNIPPET_START } from '@/shared/server/fts'
import { parsePageList } from '../pages'
import { MAX_AI_IMAGE_CHARS } from '../limits'

/** Zeichen, die read_note und read_file auf einmal liefern */
const READ_CHUNK = 30_000
/** Seiten, die read_file auf einmal liefert */
const MAX_FILE_PAGES = 10
/** Bildformate, die Claude lesen kann */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

export type ToolOutput = { content: BetaToolResultBlockParam['content']; label?: string; error?: string }

/** Ergebnis eines Werkzeugs – `label`: genauere Beschriftung im Chat (z. B. mit dem gefundenen Titel) */
const ok = (content: BetaToolResultBlockParam['content'], label?: string): ToolOutput => ({ content, label })
const fail = (error: string): ToolOutput => ({ content: error, error })

const snippet = (s: string) => s.replaceAll(SNIPPET_START, '**').replaceAll(SNIPPET_END, '**').replace(/\s+/g, ' ').trim()
const day = (ms: number) => longDate(localDate(new Date(ms)))

type NoteRow = { id: string; title: string; folderId: string | null; tags: string[]; updatedAt: number }

/** Notizen ohne Tresor – der Titel dort ist nur ein Platzhalter */
const visibleNotes = (userId: number): NoteRow[] => listNotes(userId).filter((n) => !n.vault)

/** Notiz zu ID oder Titel (ohne Groß- und Kleinschreibung; bei mehreren gleichen Titeln die zuletzt bearbeitete) */
export function findNote(userId: number, ref: string): NoteRow | null {
  const notes = visibleNotes(userId)
  const key = ref.trim().replace(/^\[\[|\]\]$/g, '').toLocaleLowerCase('de')
  return (
    notes.find((n) => n.id === ref.trim()) ??
    notes.filter((n) => n.title.toLocaleLowerCase('de') === key).sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
    null
  )
}

const pathOf = (paths: Map<string, string[]>, folderId: string | null) => (folderId ? (paths.get(folderId) ?? []).join(' / ') : '')

function searchNotesTool(userId: number, input: { query: string }): ToolOutput {
  const paths = folderPathMap(userId)
  const hits = searchNotes(userId, input.query, { limit: 10 })
  if (!hits.length) return ok(`Keine Notiz passt zu „${input.query}“.`)
  return ok(
    hits
      .map((h) => {
        const folder = pathOf(paths, h.folderId)
        return `- [[${h.title}]] (ID ${h.id}${folder ? `, Ordner ${folder}` : ''}): ${snippet(h.snippet)}`
      })
      .join('\n'),
  )
}

function readNoteTool(userId: number, input: { note: string; offset?: number }): ToolOutput {
  const found = findNote(userId, input.note)
  if (!found) return fail(`Keine Notiz „${input.note}“ gefunden (Notizen aus dem Tresor sind nicht zugänglich).`)
  const note = getNote(userId, found.id)
  if (note.vault) return fail('Notizen aus dem Tresor sind nicht zugänglich.')
  const text = noteText(note.format, note.content)
  const offset = Math.max(0, Math.min(input.offset ?? 0, text.length))
  const part = text.slice(offset, offset + READ_CHUNK)
  const rest = text.length - offset - part.length
  const head = `Notiz [[${note.title}]] (ID ${note.id}, Format ${note.format}, zuletzt geändert ${day(note.updatedAt)})`
  const range = offset || rest ? `\nZeichen ${offset}–${offset + part.length} von ${text.length}.` : ''
  const more = rest > 0 ? ` Weiter mit offset ${offset + part.length}.` : ''
  return ok(`${head}${range}${more}\n\n${part || '(leer)'}`, `Liest „${note.title}“`)
}

function listNotesTool(userId: number, input: { folder?: string }): ToolOutput {
  const paths = folderPathMap(userId)
  let notes = visibleNotes(userId)
  if (input.folder?.trim()) {
    const key = input.folder.trim().toLocaleLowerCase('de')
    notes = notes.filter((n) => n.folderId && (paths.get(n.folderId) ?? []).some((p) => p.toLocaleLowerCase('de') === key))
    if (!notes.length) return ok(`Keine Notizen im Ordner „${input.folder}“.`)
  }
  const shown = [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60)
  const lines = shown.map((n) => {
    const folder = pathOf(paths, n.folderId)
    const tags = n.tags.length ? ` #${n.tags.join(' #')}` : ''
    return `- [[${n.title}]] (ID ${n.id}${folder ? `, ${folder}` : ''}, ${day(n.updatedAt)})${tags}`
  })
  const more = notes.length > shown.length ? `\n… und ${notes.length - shown.length} weitere.` : ''
  return ok(`${notes.length} Notizen, zuletzt bearbeitete zuerst:\n${lines.join('\n')}${more}`)
}

function searchFilesTool(userId: number, input: { query: string }): ToolOutput {
  const hits = searchAttachments(userId, input.query, 10)
  if (!hits.length) return ok(`Keine Datei passt zu „${input.query}“ (durchsucht wird der Text von PDFs und Textdateien).`)
  return ok(hits.map((h) => `- ${h.filename}, S. ${h.page} (ID ${h.id}): ${snippet(h.snippet)}`).join('\n'))
}

function readFileTool(userId: number, input: { file: string; pages?: string }): ToolOutput {
  const files = listAttachments(userId)
  const key = input.file.trim().toLocaleLowerCase('de')
  const file = files.find((f) => f.id === input.file.trim()) ?? files.find((f) => f.filename.toLocaleLowerCase('de') === key)
  if (!file) return fail(`Keine Datei „${input.file}“ gefunden.`)
  const label = `Liest „${file.filename}“${input.pages ? ` (S. ${input.pages})` : ''}`
  if ((IMAGE_TYPES as readonly string[]).includes(file.mime)) {
    // base64 macht ein Drittel größer – größere Bilder nähme Anthropic nicht an
    if (file.size * 4 > MAX_AI_IMAGE_CHARS * 3) return fail(`Das Bild „${file.filename}“ ist zu groß zum Lesen.`)
    const data = readAttachmentData(userId, file.id).toString('base64')
    return ok(
      [
        { type: 'text', text: `Bild ${file.filename}:` },
        { type: 'image', source: { type: 'base64', media_type: file.mime as (typeof IMAGE_TYPES)[number], data } },
      ],
      label,
    )
  }
  const all = attachmentPageTexts(userId, file.id)
  if (!all.length) return fail(`Von „${file.filename}“ gibt es keinen lesbaren Text (z. B. ein Scan ohne Text oder noch nicht ausgelesen).`)
  let pages: number[]
  if (input.pages?.trim()) {
    const parsed = parsePageList(input.pages, all[all.length - 1].page)
    if (typeof parsed === 'string') return fail(parsed)
    pages = parsed.slice(0, MAX_FILE_PAGES)
  } else {
    pages = all.slice(0, MAX_FILE_PAGES).map((p) => p.page)
  }
  const wanted = new Set(pages)
  let budget = READ_CHUNK
  const parts: string[] = []
  for (const p of all.filter((x) => wanted.has(x.page))) {
    if (budget <= 0) break
    const text = p.text.slice(0, budget)
    budget -= text.length
    parts.push(`[[${file.filename}#page=${p.page}|S. ${p.page}]]\n${text}`)
  }
  const head = `Datei ${file.filename} (ID ${file.id}), ${all.length} ${all.length === 1 ? 'Seite' : 'Seiten'} mit Text.`
  return ok(`${head}\n\n${parts.join('\n\n')}`, label)
}

function searchCardsTool(userId: number, input: { query?: string; deck?: string }): ToolOutput {
  const data = getFlashcardData(userId)
  const states = stateMap(data.reviews)
  const deckKey = input.deck?.trim().toLocaleLowerCase('de')
  const decks = deckKey ? data.decks.filter((d) => d.name.toLocaleLowerCase('de') === deckKey) : data.decks
  if (deckKey && !decks.length) return fail(`Keinen Stapel „${input.deck}“ gefunden.`)
  const deckNames = new Map(decks.map((d) => [d.id, d.name]))
  const words = (input.query ?? '').split(/\s+/).filter(Boolean)
  const cards = data.cards.filter((c) => deckNames.has(c.deckId) && words.every((w) => cardMatches(c, w)))
  if (!cards.length) return ok('Keine passenden Karteikarten.')
  const now = Date.now()
  const today = endOfDay(now, data.dayStartHour)
  const lines = cards.slice(0, 25).map((c) => {
    const sides = sidesOf(c).map((s) => states.get(reviewKey(c.id, s)) ?? null)
    const due = sides.some((s) => !s) ? 'neu' : Math.min(...sides.map((s) => s!.due)) <= today ? 'heute fällig' : `fällig ${day(Math.min(...sides.map((s) => s!.due)))}`
    const lapses = cardLapses(c, states)
    const answer = c.type === 'mc' ? c.options.map((o) => `${o.correct ? '✓' : '✗'} ${o.text}`).join('; ') : c.back
    const flags = [c.type, due, lapses ? `${lapses}× vergessen` : '', c.suspended ? 'ausgesetzt' : ''].filter(Boolean).join(', ')
    return `- [${deckNames.get(c.deckId)}] ${c.front.replace(/\s+/g, ' ').slice(0, 300)} → ${answer.replace(/\s+/g, ' ').slice(0, 300)} (${flags})`
  })
  const more = cards.length > 25 ? `\n… und ${cards.length - 25} weitere.` : ''
  return ok(`${cards.length} ${cards.length === 1 ? 'Karte' : 'Karten'}:\n${lines.join('\n')}${more}`)
}

const minutes = (ms: number) => {
  const m = Math.round(ms / 60_000)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}

function studyOverviewTool(userId: number): ToolOutput {
  const data = getFlashcardData(userId)
  const states = stateMap(data.reviews)
  const exams = examsByDeck(listEvents(userId))
  const now = Date.now()
  const lines: string[] = []
  let due = 0
  for (const deck of data.decks) {
    const planned = { ...deck, exams: exams.get(deck.id) }
    const cards = data.cards.filter((c) => c.deckId === deck.id)
    const counts = deckCounts(planned, cards, states, now, data.dayStartHour)
    due += counts.due
    const problems = cards.filter((c) => isProblemCard(c, states, deck.leechLapses)).length
    const suspended = cards.filter((c) => c.suspended).length
    const exam = nextExam(planned.exams, now, data.dayStartHour)
    lines.push(
      `- ${deck.name}: ${cards.length} Karten, heute fällig ${counts.due} (neu ${counts.newToday}, Lernphase ${counts.learning}, Wiederholungen ${counts.review})` +
        `, noch nie gelernt ${counts.newTotal}, morgen fällig ${counts.dueTomorrow}` +
        (problems ? `, ${problems} Problemkarten` : '') +
        (suspended ? `, ${suspended} ausgesetzt` : '') +
        (exam ? `; Klausur „${exam.title}“ am ${longDate(exam.date)} (in ${daysUntil(exam, now, data.dayStartHour)} Tagen)` : ''),
    )
  }
  const { sessions } = listFocusSessions(userId, now)
  const since = (days: number) => sessions.filter((s) => s.startedAt >= now - days * 86_400_000)
  const bySubject = (list: typeof sessions) => {
    const map = new Map<string, number>()
    for (const s of list) map.set(s.subject || 'ohne Fach', (map.get(s.subject || 'ohne Fach') ?? 0) + s.durationMs)
    return [...map].sort((a, b) => b[1] - a[1]).map(([subject, ms]) => `${subject} ${minutes(ms)}`).join(', ')
  }
  const week = since(7)
  const month = since(28)
  const focus = month.length
    ? `Lernzeit (Fokus-Timer): letzte 7 Tage ${minutes(week.reduce((n, s) => n + s.durationMs, 0))}${week.length ? ` (${bySubject(week)})` : ''}; ` +
      `letzte 28 Tage ${minutes(month.reduce((n, s) => n + s.durationMs, 0))} (${bySubject(month)}).`
    : 'Lernzeit: In den letzten 28 Tagen wurden keine Fokus-Runden gezählt.'
  if (!data.decks.length) return ok(`Es gibt noch keine Karteikarten-Stapel.\n${focus}`)
  return ok(`Heute insgesamt ${due} Karten fällig.\nStapel:\n${lines.join('\n')}\n${focus}`)
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function listEventsTool(userId: number, input: { from?: string; to?: string }, today: string): ToolOutput {
  const from = input.from && DAY_RE.test(input.from) ? input.from : today
  let to = input.to && DAY_RE.test(input.to) ? input.to : addDays(from, 14)
  if (to < from) to = from
  if (to > addDays(from, 90)) to = addDays(from, 90)
  const found = occurrences(listEvents(userId), from, addDays(to, 1)).sort((a, b) => a.start.localeCompare(b.start))
  if (!found.length) return ok(`Keine Termine vom ${longDate(from)} bis ${longDate(to)}.`)
  const lines = found.slice(0, 100).map((o) => {
    const e = o.event
    const when = e.allDay
      ? `${weekdayName(o.date).slice(0, 2)}., ${shortDate(o.date)} ganztägig`
      : `${weekdayName(o.date).slice(0, 2)}., ${shortDate(o.date)} ${timeOf(o.start)}–${timeOf(o.end)}`
    const extra = [e.location, e.exam ? 'Klausur' : '', e.repeat ? 'Serie' : ''].filter(Boolean).join(', ')
    return `- ${when} ${e.title}${extra ? ` (${extra})` : ''}${e.notes.trim() ? ` – ${e.notes.trim().replace(/\s+/g, ' ').slice(0, 200)}` : ''}`
  })
  return ok(`Termine vom ${longDate(from)} bis ${longDate(to)}:\n${lines.join('\n')}`)
}

const INPUTS = {
  search_notes: z.object({ query: z.string().min(1).max(500) }),
  read_note: z.object({ note: z.string().min(1).max(1000), offset: z.number().int().min(0).optional() }),
  list_notes: z.object({ folder: z.string().max(500).optional() }),
  search_files: z.object({ query: z.string().min(1).max(500) }),
  read_file: z.object({ file: z.string().min(1).max(1000), pages: z.string().max(200).optional() }),
  search_cards: z.object({ query: z.string().max(500).optional(), deck: z.string().max(500).optional() }),
  study_overview: z.object({}),
  list_events: z.object({ from: z.string().max(20).optional(), to: z.string().max(20).optional() }),
}

export const READ_TOOLS = new Set(Object.keys(INPUTS))

/** Ein lesendes Werkzeug ausführen. `today`: Datum des Geräts (für Termine ohne Angabe) */
export function runReadTool(userId: number, name: string, input: unknown, today: string): ToolOutput {
  const schema = INPUTS[name as keyof typeof INPUTS]
  if (!schema) return fail(`Unbekanntes Werkzeug ${name}.`)
  const parsed = schema.safeParse(input ?? {})
  if (!parsed.success) return fail(`Ungültige Eingabe für ${name}.`)
  try {
    switch (name) {
      case 'search_notes':
        return searchNotesTool(userId, parsed.data as z.infer<typeof INPUTS.search_notes>)
      case 'read_note':
        return readNoteTool(userId, parsed.data as z.infer<typeof INPUTS.read_note>)
      case 'list_notes':
        return listNotesTool(userId, parsed.data as z.infer<typeof INPUTS.list_notes>)
      case 'search_files':
        return searchFilesTool(userId, parsed.data as z.infer<typeof INPUTS.search_files>)
      case 'read_file':
        return readFileTool(userId, parsed.data as z.infer<typeof INPUTS.read_file>)
      case 'search_cards':
        return searchCardsTool(userId, parsed.data as z.infer<typeof INPUTS.search_cards>)
      case 'study_overview':
        return studyOverviewTool(userId)
      default:
        return listEventsTool(userId, parsed.data as z.infer<typeof INPUTS.list_events>, today)
    }
  } catch (err) {
    if (err instanceof ApiError) return fail(err.message)
    console.error('[noted] Werkzeug des KI-Chats fehlgeschlagen', name, err)
    return fail('Das hat nicht geklappt.')
  }
}
