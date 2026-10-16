import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getFlashcardData } from '@/features/flashcards/server/flashcards'

/** Alle Stapel, Karten und der Lernstand */
export const GET = route('user', ({ user }) => json(getFlashcardData(user.id)))
