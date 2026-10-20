// Stapel als Datei (.noted-deck.zip) – verlustfrei zwischen Konten und Noted-Instanzen: deck.json mit Stapel und
// Karten (alle Kartenarten, Antworten, Lücken, Bildverdeckungen) und der Ordner media/ mit den verwendeten Dateien.
// Lernstand, IDs und die Verknüpfung mit Notizen gehören zum Konto und kommen nicht mit.
// Reine Logik ohne Browser- oder Server-Abhängigkeit – Dateien lesen und anlegen macht server/deck-package.ts.
import { strFromU8, strToU8, unzipSync } from 'fflate'
import { z } from 'zod'
import { fileReferences } from '@/features/attachments/references'
import { escapeRegExp } from '@/shared/lib/regexp'
import { DEFAULT_NEW_PER_DAY, DEFAULT_RETENTION } from './srs'
import { MAX_NEW_PER_DAY } from './limits'
import type { Card, Deck } from './types'

/** Dateiendung – daran erkennt auch der allgemeine Import ein Paket */
export const DECK_PACKAGE_EXT = '.noted-deck.zip'
const VERSION = 1
const MANIFEST = 'deck.json'
const MEDIA_DIR = 'media/'
/** Mehr Einträge hat kein sinnvolles Paket (Anki-Import: 50 000) */
const MAX_ENTRIES = 50_000

export type DeckSettings = Pick<Deck, 'name' | 'description' | 'newPerDay' | 'typeAnswer' | 'scheduler' | 'retention'>
export type PackageCard = Pick<Card, 'type' | 'front' | 'back' | 'options' | 'occlusion' | 'position' | 'suspended'>
export type DeckManifest = { noted: number; deck: DeckSettings; cards: PackageCard[]; media: string[] }

/** Ungültiges Paket – die Meldung ist für Nutzer gedacht */
export class DeckPackageError extends Error {}

/** Dateien, die eine Karte verwendet (klein geschrieben): Einbettungen und Links in den Texten, das verdeckte Bild */
export function cardMedia(card: Pick<Card, 'front' | 'back' | 'options' | 'occlusion'>): Set<string> {
  const texts = [card.front, card.back, ...card.options.map((o) => o.text)]
  const names = new Set(texts.flatMap((t) => [...fileReferences('markdown', t)]))
  if (card.occlusion?.image) names.add(card.occlusion.image.toLowerCase())
  return names
}

/**
 * Inhalt von deck.json. `files`: Anhänge des Kontos – Verweise bekommen deren Schreibweise. Fehlt ein Anhang, steht der
 * Name trotzdem in der Liste (`missing`), die Datei fehlt dann im Paket.
 */
export function createManifest(
  deck: DeckSettings,
  cards: PackageCard[],
  files: string[],
): { manifest: DeckManifest; missing: string[] } {
  const byKey = new Map(files.map((f) => [f.toLowerCase(), f]))
  const media = new Set<string>()
  const missing = new Set<string>()
  for (const card of cards) {
    for (const key of cardMedia(card)) {
      const file = byKey.get(key)
      media.add(file ?? key)
      if (!file) missing.add(key)
    }
  }
  const { name, description, newPerDay, typeAnswer, scheduler, retention } = deck
  return {
    manifest: {
      noted: VERSION,
      deck: { name, description, newPerDay, typeAnswer, scheduler, retention },
      cards: cards.map(({ type, front, back, options, occlusion, position, suspended }) => ({
        type,
        front,
        back,
        options,
        occlusion,
        position,
        suspended,
      })),
      media: [...media].sort(),
    },
    missing: [...missing],
  }
}

type PackageEntry = { path: string; compress: boolean; data: () => Uint8Array }

/** Dateien des Pakets in der Reihenfolge des Archivs – `read` liefert eine Datei, die es im Konto gibt, sonst null */
export function deckPackageEntries(
  manifest: DeckManifest,
  read: (name: string) => Uint8Array | null,
): PackageEntry[] {
  const entries: PackageEntry[] = [{ path: MANIFEST, compress: true, data: () => strToU8(JSON.stringify(manifest, null, 2)) }]
  for (const name of manifest.media) {
    const data = read(name)
    // Bilder und PDFs sind schon gepackt
    if (data) entries.push({ path: MEDIA_DIR + name, compress: false, data: () => data })
  }
  return entries
}

const deckSchema = z.object({
  name: z.string().min(1).max(1000),
  description: z.string().max(5000).default(''),
  newPerDay: z.number().int().min(0).max(MAX_NEW_PER_DAY).default(DEFAULT_NEW_PER_DAY),
  typeAnswer: z.boolean().default(false),
  scheduler: z.enum(['sm2', 'fsrs']).default('sm2'),
  retention: z.number().min(0.7).max(0.99).default(DEFAULT_RETENTION),
})

const unit = z.number().min(0).max(1)
const cardSchema = z.object({
  type: z.enum(['basic', 'reversed', 'mc', 'cloze', 'occlusion']),
  front: z.string(),
  back: z.string().default(''),
  options: z.array(z.object({ text: z.string(), correct: z.boolean() })).default([]),
  occlusion: z
    .object({
      image: z.string().max(1000),
      masks: z.array(z.object({ x: unit, y: unit, w: unit, h: unit, label: z.string().default('') })),
      hideAll: z.boolean().default(false),
    })
    .nullable()
    .default(null),
  position: z.number().int().default(0),
  suspended: z.boolean().default(false),
})

/** Verständlicher Grund, warum eine Karte im Paket nicht passt */
function cardIssue(error: z.ZodError): string {
  const path = error.issues[0]?.path ?? []
  if (path[0] === 'type') return 'unbekannte Kartenart'
  if (path.includes('masks')) return 'Fläche außerhalb des Bildes'
  return 'ungültige Angaben'
}

export type ParsedDeckPackage = {
  deck: DeckSettings
  /** Gültige Karten nach Position sortiert – Längen usw. prüft erst das Anlegen */
  cards: PackageCard[]
  /** Hinweise auf Karten, die nicht gelesen werden konnten */
  invalid: string[]
  /** Dateien unter ihrem Namen in deck.json */
  media: Map<string, Uint8Array>
  /** In deck.json aufgeführt, aber nicht im Paket */
  missing: string[]
  /** Größer als maxFileBytes – nicht entpackt */
  tooLarge: string[]
}

/**
 * Paket lesen und prüfen. Wirft DeckPackageError, wenn es kein lesbares Paket ist; einzelne ungültige Karten und zu
 * große Dateien landen in `invalid` bzw. `tooLarge`, damit der Rest trotzdem importiert werden kann.
 */
export function parseDeckPackage(
  data: Uint8Array,
  limits: { maxFileBytes: number; maxTotalBytes: number },
): ParsedDeckPackage {
  const tooLarge: string[] = []
  let entries: Record<string, Uint8Array>
  let count = 0
  let declared = 0
  try {
    // fflate reserviert für jeden Eintrag die angegebene Größe – daher vorher prüfen
    entries = unzipSync(data, {
      filter: (f) => {
        const media = f.name.startsWith(MEDIA_DIR) && !f.name.slice(MEDIA_DIR.length).includes('/')
        if (f.name !== MANIFEST && !media) return false
        const max = media ? limits.maxFileBytes : limits.maxTotalBytes
        if (f.originalSize > max) {
          if (media) tooLarge.push(f.name.slice(MEDIA_DIR.length))
          else throw new DeckPackageError('Das Paket ist zu groß.')
          return false
        }
        count++
        declared += f.originalSize
        if (count > MAX_ENTRIES || declared > limits.maxTotalBytes * 2) {
          throw new DeckPackageError('Das Paket enthält zu viele oder zu große Dateien.')
        }
        return true
      },
    })
  } catch (err) {
    if (err instanceof DeckPackageError) throw err
    throw new DeckPackageError('Das ist keine gültige Stapel-Datei.')
  }
  const raw = entries[MANIFEST]
  if (!raw) throw new DeckPackageError('Das ist keine Stapel-Datei aus Noted (deck.json fehlt).')
  let json: unknown
  try {
    json = JSON.parse(strFromU8(raw))
  } catch {
    throw new DeckPackageError('Die Stapel-Datei ist beschädigt (deck.json nicht lesbar).')
  }
  const head = z
    .object({ noted: z.number(), deck: z.unknown(), cards: z.array(z.unknown()), media: z.array(z.string()).default([]) })
    .safeParse(json)
  if (!head.success) throw new DeckPackageError('Das ist keine Stapel-Datei aus Noted.')
  if (head.data.noted > VERSION) throw new DeckPackageError('Die Stapel-Datei stammt aus einer neueren Noted-Version.')
  const deck = deckSchema.safeParse(head.data.deck)
  if (!deck.success) throw new DeckPackageError('Die Angaben zum Stapel in der Datei sind ungültig.')

  const cards: PackageCard[] = []
  const invalid: string[] = []
  head.data.cards.forEach((c, i) => {
    const parsed = cardSchema.safeParse(c)
    if (parsed.success) cards.push(parsed.data)
    else invalid.push(`Karte ${i + 1} (${cardIssue(parsed.error)})`)
  })
  cards.sort((a, b) => a.position - b.position)

  const media = new Map<string, Uint8Array>()
  const missing: string[] = []
  for (const name of new Set(head.data.media)) {
    const file = entries[MEDIA_DIR + name]
    if (file) media.set(name, file)
    else if (!tooLarge.includes(name)) missing.push(name)
  }
  return { deck: deck.data, cards, invalid, media, missing, tooLarge }
}

/** Verweise auf eine Datei umschreiben (![[alt.png|300]], [[alt.pdf#page=2]], /api/files/alt.png) */
export function renameFileRefs(text: string, from: string, to: string): string {
  const link = new RegExp(`(!?\\[\\[)((?:[^[\\]|#\\n]*/)?)${escapeRegExp(from)}(?=[\\]|#])`, 'gi')
  const url = new RegExp(`(/api/files/)${escapeRegExp(encodeURIComponent(from))}(?=[\\s"')#?]|$)`, 'gi')
  return text
    .replace(link, (_m, open: string, dir: string) => `${open}${dir}${to}`)
    .replace(url, (_m, prefix: string) => `${prefix}${encodeURIComponent(to)}`)
}

/** Karte mit umbenannten Dateien (Schlüssel: alter Name klein geschrieben) */
export function renameCardMedia(card: PackageCard, renames: Map<string, string>): PackageCard {
  if (renames.size === 0) return card
  const used = cardMedia(card)
  let { front, back, options, occlusion } = card
  for (const [from, to] of renames) {
    if (!used.has(from)) continue
    front = renameFileRefs(front, from, to)
    back = renameFileRefs(back, from, to)
    options = options.map((o) => ({ ...o, text: renameFileRefs(o.text, from, to) }))
    if (occlusion && occlusion.image.toLowerCase() === from) occlusion = { ...occlusion, image: to }
  }
  return { ...card, front, back, options, occlusion }
}
