// Typen für Karteikarten (API-Verträge zwischen Server und Browser)

/**
 * basic: Vorderseite → Rückseite · reversed: zusätzlich Rückseite → Vorderseite · mc: Multiple Choice ·
 * cloze: Lückentext – Lücken als ==Markierung== in der Vorderseite, die Rückseite ist ein optionaler Zusatz ·
 * occlusion: Bildverdeckung – Flächen eines Bilds werden einzeln abgefragt, die Vorderseite ist der Titel
 */
export type CardType = 'basic' | 'reversed' | 'mc' | 'cloze' | 'occlusion'

export type CardOption = { text: string; correct: boolean }

/** Verdeckte Fläche – Lage und Größe relativ zum Bild (0–1), label = was darunter steht (optional) */
export type OcclusionMask = { x: number; y: number; w: number; h: number; label: string }

/**
 * Bildverdeckung: `image` ist der Dateiname eines Anhangs. hideAll: Beim Abfragen sind alle Flächen verdeckt,
 * sonst nur die abgefragte.
 */
export type Occlusion = { image: string; masks: OcclusionMask[]; hideAll: boolean }

export type Deck = {
  id: string
  name: string
  description: string
  /** Höchstens so viele neue Karten pro Tag im Lernmodus */
  newPerDay: number
  /** Antwort beim Lernen eintippen (Grund- und beidseitige Karten) */
  typeAnswer: boolean
  /** Wiederholungsplan: SM-2 (wie Anki) oder FSRS mit gewünschter Behaltensrate (0,7–0,99) */
  scheduler: 'sm2' | 'fsrs'
  retention: number
  createdAt: number
  updatedAt: number
  /** Nur im Browser, aus dem Kalender ergänzt: Klausuren, auf die der Stapel vorbereitet (nach Datum) */
  exams?: DeckExam[]
}

/** Klausur im Kalender, mit der ein Stapel verknüpft ist – `date`: Tag der Klausur (YYYY-MM-DD) */
export type DeckExam = { id: string; title: string; date: string }

export type Card = {
  id: string
  deckId: string
  /** Notiz, aus der die Karte stammt (optional) */
  noteId: string | null
  type: CardType
  front: string
  /** Antwort – bei Multiple Choice die (optionale) Erklärung, bei Lückentexten ein (optionaler) Zusatz */
  back: string
  options: CardOption[]
  /** Nur bei Bildverdeckung */
  occlusion: Occlusion | null
  position: number
  /** Ausgesetzt: kommt beim Lernen und Üben nicht dran (z. B. eine Problemkarte bis zur Überarbeitung) */
  suspended: boolean
  createdAt: number
  updatedAt: number
}

export type CardPhase = 'learning' | 'review' | 'relearning'

/** Lernstand einer Kartenseite (Wiederholungsplan) */
export type SrsState = {
  phase: CardPhase
  /** Lernschritt (nur in den Lernphasen) */
  step: number
  /** Abstand in Tagen (in der Lernphase: 0; beim Wiederlernen: Abstand nach dem Wiederlernen) */
  interval: number
  ease: number
  reps: number
  lapses: number
  due: number
  reviewedAt: number
  /** Zeitpunkt der ersten Abfrage (für das Tageslimit neuer Karten) */
  introducedAt: number
  /** Nur mit FSRS geplant: Stabilität (Tage bis 90 % Erinnerung) und Schwierigkeit (1–10) */
  stability?: number | null
  difficulty?: number | null
}

/** side 0: Vorderseite wird abgefragt, side 1: Rückseite (nur bei beidseitigen Karten) – bei Lückentexten die Lücke */
export type CardReview = SrsState & { cardId: string; side: number }

export type FlashcardData = { decks: Deck[]; cards: Card[]; reviews: CardReview[] }

/** Eintrag im Bewertungsprotokoll: jede Bewertung im Lernmodus, auch offline gesammelte */
export type ReviewLogEntry = {
  cardId: string
  side: number
  rating: 1 | 2 | 3 | 4
  /** Phase vor der Bewertung – 'new' bei der ersten Abfrage */
  phase: CardPhase | 'new'
  /** Abstand bis zur Fälligkeit in Tagen – wie er vorher geplant war und wie er nachher geplant ist */
  intervalBefore: number
  intervalAfter: number
  /** Zeit von der Anzeige der Karte bis zur Bewertung (gekappt, siehe MAX_ANSWER_MS) */
  durationMs: number
  reviewedAt: number
}

/** Ergebnis eines Anki-Imports – `skipped`: Hinweise auf übersprungene Karten und Dateien (gekürzt) */
export type AnkiImportResult = { decks: number; cards: number; media: number; skipped: string[] }

/**
 * Ergebnis eines Stapel-Imports (.noted-deck.zip): Zielstapel (`created`: neu angelegt), angelegte Karten, neue Dateien,
 * Karten mit gleicher Vorderseite, die es im Stapel schon gab, und Hinweise auf Übersprungenes (gekürzt)
 */
export type DeckImportResult = {
  deck: { id: string; name: string; created: boolean }
  cards: number
  media: number
  duplicates: number
  skipped: string[]
}

/** Ein Tag mit Bewertungen (Datum in der Ortszeit des Geräts) */
export type StudyDay = { date: string; reviews: number; again: number; ms: number }

/** Stapel in den letzten 30 Tagen – `mature…`: Wiederholungen gelernter Karten (für die Trefferquote) */
export type DeckStudyStats = { deckId: string; reviews: number; ms: number; matureReviews: number; matureCorrect: number }

export type StudyStats = {
  /** Tage mit Bewertungen im letzten Jahr */
  days: StudyDay[]
  decks: DeckStudyStats[]
  /** Bewertungen insgesamt und Zeitpunkt der ersten */
  total: number
  since: number | null
}
