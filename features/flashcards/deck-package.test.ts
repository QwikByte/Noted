import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { zipBytes } from '@/shared/server/zip'
import {
  cardMedia,
  createManifest,
  deckPackageEntries,
  DeckPackageError,
  parseDeckPackage,
  renameCardMedia,
  renameFileRefs,
  type PackageCard,
} from './deck-package'
import type { DeckSettings } from './deck-package'

const LIMITS = { maxFileBytes: 1024, maxTotalBytes: 1024 * 1024 }

const settings: DeckSettings = {
  name: 'Anatomie',
  description: 'Herz und Kreislauf',
  newPerDay: 15,
  typeAnswer: true,
  scheduler: 'fsrs',
  retention: 0.85,
  learningSteps: [10, 60, 1440],
  relearningSteps: [30],
  reviewPerDay: 150,
  leechLapses: 4,
  leechAction: 'suspend',
}

const card = (c: Partial<PackageCard> & Pick<PackageCard, 'type' | 'front'>, position: number): PackageCard => ({
  back: '',
  options: [],
  occlusion: null,
  suspended: false,
  ...c,
  position,
})

/** Alle fünf Kartenarten, mit Bildern in Texten, Antworten und der Bildverdeckung */
const cards: PackageCard[] = [
  card({ type: 'basic', front: 'Was pumpt Blut? ![[Herz.png|200]]', back: 'Das Herz' }, 0),
  card({ type: 'reversed', front: 'Aorta', back: 'Hauptschlagader', suspended: true }, 1),
  card(
    {
      type: 'mc',
      front: 'Welche Kammern?',
      back: 'Siehe [[Skript.pdf#page=3]]',
      options: [
        { text: 'links ![[kammer.png]]', correct: true },
        { text: 'oben', correct: false },
      ],
    },
    2,
  ),
  card({ type: 'cloze', front: 'Das Herz hat ==vier== Kammern.', back: 'Zusatz' }, 3),
  card(
    {
      type: 'occlusion',
      front: 'Herz beschriften',
      occlusion: { image: 'Herz.png', masks: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1, label: 'Aorta' }], hideAll: true },
    },
    4,
  ),
]

function pack(files: string[], data: Record<string, Uint8Array>) {
  const { manifest, missing } = createManifest(settings, cards, files)
  const bytes = zipBytes(deckPackageEntries(manifest, (name) => data[name] ?? null))
  return { manifest, missing, bytes }
}

describe('Stapel-Datei', () => {
  it('überträgt Stapel-Einstellungen und alle Kartenarten verlustfrei samt Dateien', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1])
    const { manifest, missing, bytes } = pack(['Herz.png', 'kammer.png', 'Unbenutzt.png'], {
      'Herz.png': png,
      'kammer.png': png,
    })
    // Verweise in der Schreibweise des Kontos; die fehlende PDF steht trotzdem in der Liste
    expect(manifest.media).toEqual(['Herz.png', 'kammer.png', 'skript.pdf'])
    expect(missing).toEqual(['skript.pdf'])

    const parsed = parseDeckPackage(bytes, LIMITS)
    expect(parsed.deck).toEqual(settings)
    expect(parsed.cards).toEqual(cards)
    expect(parsed.invalid).toEqual([])
    expect([...parsed.media.keys()]).toEqual(['Herz.png', 'kammer.png'])
    expect(parsed.media.get('Herz.png')).toEqual(png)
    expect(parsed.missing).toEqual(['skript.pdf'])
  })

  it('liest ältere Pakete ohne Optionen der Stapel mit den Standardwerten', () => {
    const old = { name: 'Alt', description: '', newPerDay: 20, typeAnswer: false, scheduler: 'sm2', retention: 0.9 }
    const parsed = parseDeckPackage(zipSync({ 'deck.json': strToU8(JSON.stringify({ noted: 1, deck: old, cards: [] })) }), LIMITS)
    expect(parsed.deck).toEqual({
      ...old,
      learningSteps: [1, 10],
      relearningSteps: [10],
      reviewPerDay: 9999,
      leechLapses: 6,
      leechAction: 'mark',
    })
  })

  it('findet die Dateien einer Karte', () => {
    expect([...cardMedia(cards[2])].sort()).toEqual(['kammer.png', 'skript.pdf'])
    expect([...cardMedia(cards[4])]).toEqual(['herz.png'])
    expect(cardMedia(cards[1]).size).toBe(0)
  })

  it('schreibt Verweise auf umbenannte Dateien um', () => {
    expect(renameFileRefs('![[Herz.png|200]] [[Ordner/herz.png]] [[Herz.png#page=2]] ![[Herz.pngx]]', 'herz.png', 'Herz 1.png')).toBe(
      '![[Herz 1.png|200]] [[Ordner/Herz 1.png]] [[Herz 1.png#page=2]] ![[Herz.pngx]]',
    )
    expect(renameFileRefs('[S. 1](/api/files/Skript.pdf#page=1)', 'skript.pdf', 'Skript 2.pdf')).toBe(
      '[S. 1](/api/files/Skript%202.pdf#page=1)',
    )
    const renamed = renameCardMedia(cards[4], new Map([['herz.png', 'Herz 1.png']]))
    expect(renamed.occlusion?.image).toBe('Herz 1.png')
    expect(renameCardMedia(cards[2], new Map([['kammer.png', 'Kammer 1.png']])).options[0].text).toBe('links ![[Kammer 1.png]]')
    expect(renameCardMedia(cards[1], new Map([['herz.png', 'x.png']]))).toEqual(cards[1])
  })

  it('überspringt ungültige Karten und zu große Dateien, statt das ganze Paket abzulehnen', () => {
    const manifest = {
      noted: 1,
      deck: { name: 'Kaputt' },
      cards: [
        { type: 'flip', front: 'Unbekannt' },
        { type: 'occlusion', front: 'Außerhalb', occlusion: { image: 'a.png', masks: [{ x: 2, y: 0, w: 0.1, h: 0.1 }] } },
        { type: 'basic', front: 'Gut', back: 'Ja' },
      ],
      media: ['gross.png', 'fehlt.png'],
    }
    const bytes = zipSync({
      'deck.json': strToU8(JSON.stringify(manifest)),
      'media/gross.png': new Uint8Array(LIMITS.maxFileBytes + 1),
      'media/anderes/pfad.png': new Uint8Array(1),
    })
    const parsed = parseDeckPackage(bytes, LIMITS)
    // Fehlende Einstellungen bekommen die Standardwerte
    expect(parsed.deck).toMatchObject({ name: 'Kaputt', scheduler: 'sm2', typeAnswer: false })
    expect(parsed.cards.map((c) => c.front)).toEqual(['Gut'])
    expect(parsed.invalid).toEqual(['Karte 1 (unbekannte Kartenart)', 'Karte 2 (Fläche außerhalb des Bildes)'])
    expect(parsed.tooLarge).toEqual(['gross.png'])
    expect(parsed.missing).toEqual(['fehlt.png'])
    expect(parsed.media.size).toBe(0)
  })

  it('lehnt Dateien ab, die kein Stapel aus Noted sind', () => {
    const reject = (bytes: Uint8Array, message: RegExp) => expect(() => parseDeckPackage(bytes, LIMITS)).toThrow(message)
    expect(() => parseDeckPackage(strToU8('kein zip'), LIMITS)).toThrow(DeckPackageError)
    reject(zipSync({ 'notiz.md': strToU8('# Hallo') }), /deck\.json fehlt/)
    reject(zipSync({ 'deck.json': strToU8('{kaputt') }), /beschädigt/)
    reject(zipSync({ 'deck.json': strToU8('{"cards": []}') }), /keine Stapel-Datei/)
    reject(zipSync({ 'deck.json': strToU8(JSON.stringify({ noted: 2, deck: settings, cards: [] })) }), /neueren Noted-Version/)
    reject(zipSync({ 'deck.json': strToU8(JSON.stringify({ noted: 1, deck: { name: '' }, cards: [] })) }), /Angaben zum Stapel/)
    reject(zipSync({ 'deck.json': new Uint8Array(LIMITS.maxTotalBytes + 1) }), /zu groß/)
  })
})
