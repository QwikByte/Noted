// Typen für die KI-Anbindung (API-Verträge zwischen Server und Browser)
import type { CardOption } from '@/features/flashcards/types'
import type { AiModel } from './models'

/** `configured`: Ein Schlüssel ist hinterlegt – `keyHint`: seine letzten Zeichen (der Schlüssel selbst bleibt auf dem Server) */
export type AiSettings = {
  configured: boolean
  model: AiModel
  keyHint: string | null
  updatedAt: number | null
}

type CardDraft = { type: 'basic' | 'reversed' | 'cloze' | 'mc'; front: string; back: string; options: CardOption[] }

/**
 * Von Claude vorgeschlagene Karte – noch nicht gespeichert, Bildverdeckungen schlägt Claude nicht vor. `page`: Seite
 * des PDFs, aus der die Karte stammt (sonst null).
 */
export type SuggestedCard = CardDraft & { page: number | null }

/** Bild für Claude, z. B. eine PDF-Seite oder ein markierter Bereich – `data` base64 ohne „data:“-Präfix */
export type AiImage = { mediaType: 'image/jpeg' | 'image/png'; data: string }

/** Seite eines PDFs: Text aus dem PDF und – für Formeln, Abbildungen und Scans – ihr Bild */
export type PdfPageInput = { page: number; text: string; image?: AiImage }

/** Markierung in einem PDF: zitierter Text, Kommentar und bei Bereichen ihr Bild */
export type PdfMarkInput = { page: number; quote: string; comment: string; image?: AiImage }

/**
 * Woraus Claude Karten vorschlägt: einer Notiz, Seiten oder Markierungen eines PDFs – oder einer vorhandenen Karte, die
 * es überarbeiten (`improve`, genau eine Karte) bzw. in kleinere aufteilen soll (`split`)
 */
export type CardSource =
  | { kind: 'note'; noteId: string; title: string; content: string }
  | { kind: 'pdf'; file: string; pages: PdfPageInput[]; marks: PdfMarkInput[] }
  | { kind: 'card'; mode: CardMode; card: CardDraft }

/** `leech`: eine Problemkarte (oft vergessen) leichter merkbar machen – überarbeiten oder in wenige Karten teilen */
export type CardMode = 'improve' | 'split' | 'leech'

/** `existing`: Vorderseiten vorhandener Karten, die Claude nicht noch einmal vorschlagen soll */
export type CardsRequest = { source: CardSource; existing?: string[]; wishes?: string }

/** Assistent: Text ändern (`edit`, das Ergebnis ersetzt ihn) oder eine Frage dazu beantworten (`answer`) */
export type AssistTask = 'edit' | 'answer'

export type AssistRequest = {
  task: AssistTask
  instruction: string
  /** Titel der Notiz bzw. Name des PDFs */
  title: string
  /** Der Text, um den es geht: Markierung oder ganze Notiz, im PDF der markierte Text bzw. der Text der Seiten */
  text: string
  /** Zusammenhang zum Verständnis (z. B. die ganze Notiz), wenn `text` nur ein Ausschnitt ist */
  context?: string
  /** Einfacher Text statt Markdown – das Ergebnis dann ebenso */
  plain?: boolean
  /** PDF-Seiten oder markierte Bereiche */
  images?: AiImage[]
  /** Notiz, aus der der Text stammt – der Server lehnt Tresor-Notizen ab */
  noteId?: string
}

/**
 * Eine Zeile der gestreamten Antwort des Assistenten (JSON je Zeile). `reset`: Ein anderes Modell hat nach einer
 * Ablehnung übernommen – der bisherige Text gilt nicht mehr. `truncated`: an der Längengrenze abgeschnitten.
 */
export type AssistEvent =
  | { text: string }
  | { reset: true }
  | { done: true; truncated: boolean }
  | { error: string; code: string }

/** Vorschlag für Titel und Tags einer Notiz – `title` null, wenn Claude keinen brauchbaren geliefert hat */
export type MetaSuggestion = { title: string | null; tags: string[] }

/** Urteil über eine Antwort: ganz, teilweise oder nicht richtig */
export type GradeVerdict = 'correct' | 'partial' | 'wrong'

/**
 * Antwort auf eine Frage oder Aufgabe, die Claude bewerten soll. `expected`: Musterlösung bzw. Rückseite der Karte,
 * `images`: Fotos einer handschriftlichen Lösung, `points`: erreichbare Punkte (Probeklausur)
 */
export type GradeItem = { question: string; expected: string; answer: string; images?: AiImage[]; points?: number }

/** `title`: Stapel, Notiz oder Klausur · `context`: Zusammenhang, z. B. der Abschnitt der Notiz · `noteId`: Herkunft */
export type GradeRequest = { items: GradeItem[]; title: string; context?: string; noteId?: string }

/** `points`: erreichte Punkte – ohne Punktzahl der Aufgabe 1, 0,5 oder 0 */
export type GradeResult = { verdict: GradeVerdict; points: number; feedback: string }

/**
 * Frage von Claude zum Abfragen (Tutor) oder Aufgabe einer Probeklausur. `answer`: Musterlösung (bei Aufgaben mit
 * Erwartungshorizont), `topic`: Überschrift der Notiz bzw. Thema, aus dem sie stammt (sonst leer)
 */
export type QuizQuestion = { question: string; answer: string; points: number; topic: string }

/**
 * Woraus Claude Fragen stellt: eine Notiz (Tutor) oder Stapel samt der Notizen ihrer Karten (Probeklausur – der Server
 * lädt beides selbst)
 */
export type QuestionsSource =
  | { kind: 'note'; noteId: string; title: string; content: string }
  | { kind: 'decks'; title: string; deckIds: string[] }

export type QuestionsRequest = { source: QuestionsSource; count: number; wishes?: string }
