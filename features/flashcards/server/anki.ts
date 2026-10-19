import 'server-only'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'
import { unzipSync } from 'fflate'
import { getDb } from '@/shared/server/db'
import { getConfig } from '@/shared/server/config'
import { ApiError, badRequest } from '@/shared/server/http'
import { sanitizeFilename } from '@/shared/lib/names'
import { listAttachments, saveAttachment } from '@/features/attachments/server/attachments'
import { ankiCardKind, ankiDeckName, ankiFieldToMarkdown, ankiMediaRefs, ankiState, type AnkiCard } from '../anki'
import { MAX_ANSWER_MS, MAX_CARD_TEXT } from '../limits'
import { DAY } from '../srs'
import { createCards, createDeck, saveReviews, type CardInput } from './flashcards'
import type { AnkiImportResult, Card, CardReview, Deck, ReviewLogEntry } from '../types'

/** Höchstens so viele Hinweise auf übersprungene Karten in der Antwort */
const MAX_SKIPPED = 20

const COLLECTIONS = ['collection.anki21b', 'collection.anki21', 'collection.anki2']

// ---------------------------------------------------------------------------
// Paket lesen
// ---------------------------------------------------------------------------

/** Neues Format (ab Anki 2.1.50): Sammlung, Medienliste und Medien sind mit zstd gepackt */
function unzstd(data: Uint8Array, max: number, what = 'Das Anki-Paket'): Uint8Array {
  try {
    return zlib.zstdDecompressSync(data, { maxOutputLength: max })
  } catch (err) {
    // Entpackt wäre es größer als erlaubt – sonst läge es komplett im Arbeitsspeicher
    if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new ApiError(413, 'too_large', `${what} ist entpackt zu groß (max. ${Math.round(max / 1024 / 1024)} MB).`)
    }
    throw badRequest(`${what} konnte nicht entpackt werden.`)
  }
}

function readVarint(buf: Uint8Array, start: number): [number, number] {
  let value = 0
  let shift = 0
  let pos = start
  while (pos < buf.length) {
    const b = buf[pos++]
    value += (b & 0x7f) * 2 ** shift
    if (b < 0x80) return [value, pos]
    shift += 7
  }
  throw badRequest('Die Medienliste des Anki-Pakets ist beschädigt.')
}

/** Felder einer Protobuf-Nachricht: [Feldnummer, Wert] – Zahlen oder Bytes */
function protoFields(buf: Uint8Array): [number, number | Uint8Array][] {
  const out: [number, number | Uint8Array][] = []
  let pos = 0
  while (pos < buf.length) {
    const [key, next] = readVarint(buf, pos)
    pos = next
    const field = Math.floor(key / 8)
    const wire = key % 8
    if (wire === 0) {
      const [v, p] = readVarint(buf, pos)
      out.push([field, v])
      pos = p
    } else if (wire === 2) {
      const [len, p] = readVarint(buf, pos)
      out.push([field, buf.subarray(p, p + len)])
      pos = p + len
    } else if (wire === 1) pos += 8
    else if (wire === 5) pos += 4
    else throw badRequest('Die Medienliste des Anki-Pakets ist beschädigt.')
  }
  return out
}

/**
 * Medien des Pakets: Name → Inhalt. Älteres Format: Datei „media“ als JSON {"0": "bild.jpg"}, die Dateien heißen
 * 0, 1, … Neues Format: „media“ ist eine gepackte Protobuf-Liste (Name = Feld 1, Dateiname im ZIP = Index oder
 * Feld 255), die Dateien sind einzeln gepackt.
 */
function mediaFiles(entries: Record<string, Uint8Array>, packed: boolean, max: number): Map<string, () => Uint8Array> {
  const out = new Map<string, () => Uint8Array>()
  const meta = entries['media']
  if (!meta || meta.length === 0) return out
  if (!packed) {
    try {
      const json = JSON.parse(new TextDecoder().decode(meta)) as Record<string, unknown>
      for (const [file, name] of Object.entries(json)) {
        if (typeof name === 'string' && entries[file]) out.set(name, () => entries[file])
      }
    } catch {
      /* keine lesbare Medienliste – Karten kommen trotzdem */
    }
    return out
  }
  protoFields(unzstd(meta, 64 * 1024 * 1024)).forEach(([field, value], index) => {
    if (field !== 1 || typeof value === 'number') return
    let name = ''
    let file = String(index)
    for (const [f, v] of protoFields(value)) {
      if (f === 1 && typeof v !== 'number') name = new TextDecoder().decode(v)
      if (f === 255 && typeof v === 'number') file = String(v)
    }
    const data = entries[file]
    if (name && data) out.set(name, () => unzstd(data, max))
  })
  return out
}

function openPackage(data: Uint8Array) {
  const { maxImportBytes, maxUploadBytes } = getConfig()
  let entries: Record<string, Uint8Array>
  let count = 0
  let declared = 0
  try {
    // fflate reserviert für jeden Eintrag die angegebene Größe – daher vorher prüfen
    entries = unzipSync(data, {
      filter: (f) => {
        const max = COLLECTIONS.includes(f.name) ? maxImportBytes : maxUploadBytes
        if (f.originalSize > max) return false
        count++
        declared += f.originalSize
        if (count > 50_000 || declared > maxImportBytes * 2) {
          throw new ApiError(413, 'too_large', 'Das Anki-Paket enthält zu viele oder zu große Dateien.')
        }
        return true
      },
    })
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw badRequest('Das ist keine gültige Anki-Datei (.apkg).')
  }
  // Neuere Pakete enthalten zusätzlich eine alte Sammlung, die nur zum Aktualisieren von Anki auffordert
  const packed = !!entries['collection.anki21b']
  // Die entpackte Sammlung liegt komplett im Arbeitsspeicher – daher dieselbe Grenze wie für den Import selbst
  const raw = packed
    ? unzstd(entries['collection.anki21b'], maxImportBytes, 'Die Anki-Sammlung')
    : (entries['collection.anki21'] ?? entries['collection.anki2'])
  if (!raw) throw badRequest('Im Paket ist keine Anki-Sammlung.')
  let db: Database.Database
  try {
    // Fremde Datei: nur lesen, damit sie nichts anlegen oder ändern kann
    db = new Database(Buffer.from(raw), { readonly: true })
    db.prepare('SELECT crt FROM col').get()
  } catch {
    throw badRequest('Die Anki-Sammlung im Paket ist nicht lesbar.')
  }
  return { db, media: mediaFiles(entries, packed, maxUploadBytes) }
}

type NoteRow = { id: number; flds: string }
type CardRow = AnkiCard & { id: number; nid: number; did: number; ord: number }
type RevlogRow = { id: number; cid: number; ease: number; ivl: number; lastIvl: number; time: number; type: number }

function deckNames(db: Database.Database): Map<number, string> {
  const out = new Map<number, string>()
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'decks'").get()
  if (table) {
    for (const r of db.prepare('SELECT id, name FROM decks').all() as { id: number; name: string }[]) out.set(r.id, r.name)
    return out
  }
  try {
    const { decks } = db.prepare('SELECT decks FROM col').get() as { decks: string }
    for (const d of Object.values(JSON.parse(decks) as Record<string, { id: number; name: string }>)) out.set(Number(d.id), d.name)
  } catch {
    /* Stapelnamen fehlen – dann heißt alles „Anki“ */
  }
  return out
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

type Draft = { input: CardInput; cards: CardRow[]; sideOfOrd: (ord: number) => number | null }

/** Karten in Blöcken anlegen; lehnt der Server einen Block ab, Karte für Karte – ungültige werden übersprungen */
function createAll(userId: number, deckId: string, drafts: Draft[], skip: (reason: string) => void): [Draft, Card][] {
  const out: [Draft, Card][] = []
  for (let i = 0; i < drafts.length; i += 500) {
    const chunk = drafts.slice(i, i + 500)
    try {
      createCards(userId, deckId, chunk.map((d) => d.input)).forEach((card, k) => out.push([chunk[k], card]))
      continue
    } catch (err) {
      if (!(err instanceof ApiError) || err.status === 413) throw err
    }
    for (const d of chunk) {
      try {
        out.push([d, createCards(userId, deckId, [d.input])[0]])
      } catch (err) {
        if (!(err instanceof ApiError) || err.status === 413) throw err
        skip(`„${d.input.front.slice(0, 60)}“ (${err.message})`)
      }
    }
  }
  return out
}

/**
 * Anki-Paket (.apkg, auch .colpkg) importieren: Stapel (Unterstapel als „A – B“), Karten (Grundkarte, beidseitig,
 * Lückentext) und die verwendeten Bilder und Töne als Anhänge. Mit `progress` auch Lernstand, ausgesetzte Karten
 * und das Bewertungsprotokoll. Karten, die es im Zielstapel schon gibt (gleiche Vorderseite), kommen nicht doppelt.
 */
export function importAnki(userId: number, data: Uint8Array, opts: { progress: boolean }): AnkiImportResult {
  const { db, media } = openPackage(data)
  const result: AnkiImportResult = { decks: 0, cards: 0, media: 0, skipped: [] }
  const skip = (reason: string) => {
    if (result.skipped.length < MAX_SKIPPED) result.skipped.push(reason)
  }
  try {
    const crt = (db.prepare('SELECT crt FROM col').get() as { crt: number }).crt
    const names = deckNames(db)
    const notes = db.prepare('SELECT id, flds FROM notes').all() as NoteRow[]
    const cardsByNote = new Map<number, CardRow[]>()
    for (const c of db
      .prepare('SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses FROM cards ORDER BY nid, ord')
      .all() as CardRow[]) {
      const list = cardsByNote.get(c.nid)
      if (list) list.push(c)
      else cardsByNote.set(c.nid, [c])
    }

    // Verwendete Medien als Anhänge – vorhandene Dateien gleichen Namens und gleicher Größe werden wiederverwendet
    const existing = new Map(listAttachments(userId).map((a) => [a.filename.toLowerCase(), a]))
    const saved = new Map<string, string | null>()
    const mediaName = (name: string): string | null => {
      if (saved.has(name)) return saved.get(name)!
      const load = media.get(name)
      let file: string | null = null
      if (load) {
        try {
          const bytes = load()
          const known = existing.get(sanitizeFilename(name).toLowerCase())
          if (known && known.size === bytes.byteLength) file = known.filename
          else if (bytes.byteLength > 0) {
            file = saveAttachment(userId, { name, data: bytes }).filename
            result.media++
          }
        } catch (err) {
          if (!(err instanceof ApiError)) throw err
          skip(`${name} (${err.message})`)
        }
      }
      saved.set(name, file)
      return file
    }

    // Notizen → Karten je Stapel
    const byDeck = new Map<string, Draft[]>()
    for (const note of notes) {
      const cards = cardsByNote.get(note.id)
      if (!cards?.length) continue
      const fields = note.flds.split('\x1f')
      for (const ref of fields.flatMap(ankiMediaRefs)) mediaName(ref)
      const md = (field: string | undefined) => (field ? ankiFieldToMarkdown(field, (n) => saved.get(n) ?? null) : '')
      const kind = ankiCardKind({ fields, ords: cards.map((c) => c.ord) })
      const front = md(fields[0])
      let back = md(fields[1])
      if (!back && kind.type !== 'cloze') back = fields.slice(2).map(md).filter(Boolean).join('\n\n')
      if (!front || (!back && kind.type !== 'cloze')) {
        skip(`„${front.slice(0, 60) || 'Karte ohne Text'}“ (leere Seite)`)
        continue
      }
      if (front.length > MAX_CARD_TEXT || back.length > MAX_CARD_TEXT) {
        skip(`„${front.slice(0, 60)}“ (zu lang)`)
        continue
      }
      const deck = ankiDeckName(names.get(cards[0].did) ?? 'Anki')
      const list = byDeck.get(deck) ?? []
      list.push({ input: { type: kind.type, front, back, options: [] }, cards, sideOfOrd: kind.sideOfOrd })
      byDeck.set(deck, list)
    }

    const target = getDb()
    const decks = target.prepare('SELECT * FROM decks WHERE user_id = ?').all(userId) as { id: string; name: string }[]
    const reviews: CardReview[] = []
    const log: ReviewLogEntry[] = []
    const suspend: string[] = []
    const revlog = opts.progress ? (db.prepare('SELECT id, cid, ease, ivl, lastIvl, time, type FROM revlog ORDER BY id').all() as RevlogRow[]) : []
    const revlogByCard = new Map<number, RevlogRow[]>()
    for (const r of revlog) {
      const list = revlogByCard.get(r.cid)
      if (list) list.push(r)
      else revlogByCard.set(r.cid, [r])
    }
    const now = Date.now()

    for (const [name, drafts] of byDeck) {
      let deck: Pick<Deck, 'id'> | undefined = decks.find((d) => d.name.toLowerCase() === name.toLowerCase())
      if (!deck) {
        deck = createDeck(userId, { name })
        result.decks++
      }
      const fronts = new Set(
        (target.prepare('SELECT front FROM cards WHERE deck_id = ? AND user_id = ?').all(deck.id, userId) as { front: string }[]).map(
          (r) => r.front,
        ),
      )
      const fresh = drafts.filter((d) => !fronts.has(d.input.front) && fronts.add(d.input.front))
      if (fresh.length < drafts.length) skip(`${drafts.length - fresh.length} Karten in „${name}“ gab es schon`)
      for (const [d, created] of createAll(userId, deck.id, fresh, skip)) {
        result.cards++
        if (!opts.progress) continue
        for (const c of d.cards) {
          const side = d.sideOfOrd(c.ord)
          if (side === null) continue
          if (c.queue === -1) suspend.push(created.id)
          const entries = revlogByCard.get(c.id) ?? []
          const state = ankiState(c, crt, entries.at(-1)?.id ?? null, now)
          if (state) reviews.push({ cardId: created.id, side, ...state, interval: Math.min(state.interval, 100_000) })
          entries.forEach((r, i) => {
            // Manuell verschobene Karten (type 4, ease 0) sind keine Bewertung
            if (r.ease < 1 || r.ease > 4 || r.type > 3) return
            log.push({
              cardId: created.id,
              side,
              rating: r.ease as 1 | 2 | 3 | 4,
              phase: r.type === 1 || r.type === 3 ? 'review' : r.type === 2 ? 'relearning' : i === 0 ? 'new' : 'learning',
              intervalBefore: Math.max(0, r.lastIvl),
              // Negative Abstände zählt Anki in Sekunden
              intervalAfter: r.ivl >= 0 ? r.ivl : (-r.ivl * 1000) / DAY,
              durationMs: Math.min(MAX_ANSWER_MS, Math.max(0, r.time)),
              reviewedAt: r.id,
            })
          })
        }
      }
    }
    if (reviews.length || log.length) saveReviews(userId, reviews, log)
    if (suspend.length) {
      const stmt = target.prepare('UPDATE cards SET suspended = 1 WHERE id = ? AND user_id = ?')
      target.transaction(() => suspend.forEach((id) => stmt.run(id, userId)))()
    }
    return result
  } finally {
    db.close()
  }
}
