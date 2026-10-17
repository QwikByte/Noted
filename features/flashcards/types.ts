// Typen für Karteikarten (API-Verträge zwischen Server und Browser)

/**
 * basic: Vorderseite → Rückseite · reversed: zusätzlich Rückseite → Vorderseite · mc: Multiple Choice ·
 * cloze: Lückentext – Lücken als ==Markierung== in der Vorderseite, die Rückseite ist ein optionaler Zusatz
 */
export type CardType = 'basic' | 'reversed' | 'mc' | 'cloze'

export type CardOption = { text: string; correct: boolean }

export type Deck = {
  id: string
  name: string
  description: string
  /** Höchstens so viele neue Karten pro Tag im Lernmodus */
  newPerDay: number
  /** Antwort beim Lernen eintippen (Grund- und beidseitige Karten) */
  typeAnswer: boolean
  createdAt: number
  updatedAt: number
}

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
