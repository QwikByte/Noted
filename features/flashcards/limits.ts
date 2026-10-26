// Grenzen für Karteninhalte – prüft der Server, der Karteneditor richtet sich danach.

/** Zeichen pro Kartenseite */
export const MAX_CARD_TEXT = 20_000
/** Antworten pro Multiple-Choice-Karte */
export const MAX_OPTIONS = 12
/** Zeichen pro Multiple-Choice-Antwort */
export const MAX_OPTION_TEXT = 2_000
/** Lücken pro Lückentext-Karte – je Lücke ein eigener Lernstand (Kartenseite 0 … MAX_CLOZES - 1) */
export const MAX_CLOZES = 50
/** Flächen pro Bildverdeckung – wie bei Lücken je Fläche ein eigener Lernstand */
export const MAX_MASKS = 50
/** Zeichen pro Beschriftung einer Fläche */
export const MAX_MASK_LABEL = 200
/** Höchstes Tageslimit für neue Karten */
export const MAX_NEW_PER_DAY = 9999
/** Längste gezählte Antwortzeit pro Karte – wer länger braucht, war meist abgelenkt */
export const MAX_ANSWER_MS = 120_000
/** Höchstens so viele Karten auf einmal in einer Sammelaktion (verschieben, aussetzen, löschen …) */
export const MAX_BATCH_CARDS = 5000
