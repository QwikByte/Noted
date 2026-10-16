// Typen für Karteikarten (API-Verträge zwischen Server und Browser)

/** basic: Vorderseite → Rückseite · reversed: zusätzlich Rückseite → Vorderseite · mc: Multiple Choice */
export type CardType = 'basic' | 'reversed' | 'mc'

export type CardOption = { text: string; correct: boolean }

export type Deck = {
  id: string
  name: string
  description: string
  /** Höchstens so viele neue Karten pro Tag im Lernmodus */
  newPerDay: number
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
  /** Antwort – bei Multiple Choice die (optionale) Erklärung */
  back: string
  options: CardOption[]
  position: number
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

/** side 0: Vorderseite wird abgefragt, side 1: Rückseite (nur bei beidseitigen Karten) */
export type CardReview = SrsState & { cardId: string; side: 0 | 1 }

export type FlashcardData = { decks: Deck[]; cards: Card[]; reviews: CardReview[] }
