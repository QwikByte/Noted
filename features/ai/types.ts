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

/** Von Claude vorgeschlagene Karte – noch nicht gespeichert, Bildverdeckungen schlägt Claude nicht vor */
export type SuggestedCard = { type: 'basic' | 'reversed' | 'cloze' | 'mc'; front: string; back: string; options: CardOption[] }
