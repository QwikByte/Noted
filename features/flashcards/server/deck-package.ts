import 'server-only'
// Stapel als Datei exportieren und importieren (Format siehe ../deck-package.ts)
import { getDb } from '@/shared/server/db'
import { getConfig } from '@/shared/server/config'
import { ApiError, badRequest } from '@/shared/server/http'
import type { ZipEntry } from '@/shared/server/zip'
import { sanitizeFilename, sanitizeName, splitExtension, uniqueName } from '@/shared/lib/names'
import { escapeRegExp } from '@/shared/lib/regexp'
import { listAttachments, readAttachmentData, saveAttachment } from '@/features/attachments/server/attachments'
import {
  createManifest,
  DECK_PACKAGE_EXT,
  DeckPackageError,
  deckPackageEntries,
  parseDeckPackage,
  renameCardMedia,
  type PackageCard,
} from '../deck-package'
import { createCardsSkipping, createDeck, getDeck, getFlashcardData, setSuspended } from './flashcards'
import type { Card, Deck, DeckImportResult } from '../types'

/** Höchstens so viele Hinweise auf Übersprungenes in der Antwort */
const MAX_SKIPPED = 20

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(b)
}

/** Dateien des Pakets für einen Stapel – fürs Herunterladen als Stream und für den Gesamtexport */
export function deckPackage(userId: number, deck: Deck, cards: Card[]): ZipEntry[] {
  const attachments = listAttachments(userId)
  const byName = new Map(attachments.map((a) => [a.filename, a]))
  const { manifest } = createManifest(deck, cards, attachments.map((a) => a.filename))
  return deckPackageEntries(manifest, (name) => {
    const att = byName.get(name)
    return att ? readAttachmentData(userId, att.id) : null
  }).map((e) => ({ ...e, mtime: deck.updatedAt }))
}

/** Dateiname des Pakets, z. B. „Anatomie.noted-deck.zip“ */
const deckPackageName = (deck: Pick<Deck, 'name'>) => sanitizeName(deck.name, 'Stapel') + DECK_PACKAGE_EXT

/** Paket eines Stapels zum Herunterladen */
export function exportDeckPackage(userId: number, deckId: string): { filename: string; entries: ZipEntry[] } {
  const deck = getDeck(userId, deckId)
  const cards = getFlashcardData(userId).cards.filter((c) => c.deckId === deckId)
  return { filename: deckPackageName(deck), entries: deckPackage(userId, deck, cards) }
}

/**
 * Paket importieren – als neuer Stapel (Name bei Bedarf mit „ 1“, „ 2“ …) oder in den Stapel `targetDeckId`. Dateien
 * gleichen Namens und gleicher Größe werden wiederverwendet; bekommt eine Datei einen anderen Namen, werden die
 * Verweise in den Karten angepasst. Karten, deren Vorderseite es im Zielstapel schon gibt, kommen nicht doppelt.
 * Ungültige Karten und zu große Dateien werden übersprungen, ein unlesbares Paket wird abgelehnt.
 */
export function importDeckPackage(userId: number, data: Uint8Array, opts: { targetDeckId?: string } = {}): DeckImportResult {
  const { maxUploadBytes, maxImportBytes } = getConfig()
  let parsed: ReturnType<typeof parseDeckPackage>
  try {
    parsed = parseDeckPackage(data, { maxFileBytes: maxUploadBytes, maxTotalBytes: maxImportBytes })
  } catch (err) {
    if (err instanceof DeckPackageError) throw badRequest(err.message)
    throw err
  }
  const skipped: string[] = []
  const skip = (reason: string) => {
    if (skipped.length < MAX_SKIPPED) skipped.push(reason)
  }
  parsed.invalid.forEach(skip)

  let deck: Deck
  let created = false
  if (opts.targetDeckId) deck = getDeck(userId, opts.targetDeckId)
  else {
    const names = (getDb().prepare('SELECT name FROM decks WHERE user_id = ?').all(userId) as { name: string }[]).map((r) => r.name)
    const name = parsed.deck.name.replace(/\s+/g, ' ').trim().slice(0, 190).trim() || 'Stapel'
    deck = createDeck(userId, { ...parsed.deck, name: uniqueName(name, names) })
    created = true
  }

  // Dateien: vorhandene wiederverwenden – gleicher Name und gleiche Größe, oder dieselbe Datei unter einem freien Namen
  // aus einem früheren Import („Skizze 1.png“), sonst kämen Karten mit Bildern beim erneuten Import doppelt
  const existing = listAttachments(userId)
  const renames = new Map<string, string>()
  let media = 0
  for (const [name, bytes] of parsed.media) {
    const clean = sanitizeFilename(name)
    const { base, ext } = splitExtension(clean)
    const variant = new RegExp(`^${escapeRegExp(base)}( \\d+)?${escapeRegExp(ext)}$`, 'i')
    const sameSize = existing.filter((a) => a.size === bytes.byteLength && variant.test(a.filename))
    const known =
      sameSize.find((a) => a.filename.toLowerCase() === clean.toLowerCase()) ??
      sameSize.find((a) => equalBytes(readAttachmentData(userId, a.id), bytes))
    let filename: string
    if (known) filename = known.filename
    else {
      try {
        filename = saveAttachment(userId, { name, data: bytes }).filename
        media++
      } catch (err) {
        if (!(err instanceof ApiError)) throw err
        skip(`${name} (${err.message})`)
        continue
      }
    }
    if (filename !== name) renames.set(name.toLowerCase(), filename)
  }
  for (const name of parsed.tooLarge) skip(`${name} (zu groß)`)
  for (const name of parsed.missing) skip(`${name} (fehlt im Paket)`)

  // Karten: gleiche Vorderseite im Zielstapel gibt es schon
  const fronts = new Set(
    (getDb().prepare('SELECT front FROM cards WHERE deck_id = ? AND user_id = ?').all(deck.id, userId) as { front: string }[]).map(
      (r) => r.front,
    ),
  )
  const items: { input: PackageCard }[] = []
  let duplicates = 0
  for (const card of parsed.cards.map((c) => renameCardMedia(c, renames))) {
    if (fronts.has(card.front.trim())) duplicates++
    else {
      fronts.add(card.front.trim())
      items.push({ input: card })
    }
  }
  const createdCards = createCardsSkipping(userId, deck.id, items, skip)
  const suspended = createdCards.filter(([item]) => item.input.suspended).map(([, card]) => card.id)
  if (suspended.length) setSuspended(userId, suspended, true)
  return { deck: { id: deck.id, name: deck.name, created }, cards: createdCards.length, media, duplicates, skipped }
}
