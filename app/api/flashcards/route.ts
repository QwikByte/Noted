import { json, route } from '@/lib/server/http'
import { getFlashcardData } from '@/lib/server/flashcards'

/** Alle Stapel, Karten und der Lernstand */
export const GET = route('user', ({ user }) => json(getFlashcardData(user.id)))
