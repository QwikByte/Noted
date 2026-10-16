import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { resetDeckProgress } from '@/features/flashcards/server/flashcards'

/** Lernstand des Stapels zurücksetzen */
export const DELETE = route<{ id: string }>('user', ({ user, params }) => json(resetDeckProgress(user.id, params.id)))
