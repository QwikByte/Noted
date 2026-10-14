import { json, route } from '@/lib/server/http'
import { resetDeckProgress } from '@/lib/server/flashcards'

/** Lernstand des Stapels zurücksetzen */
export const DELETE = route<{ id: string }>('user', ({ user, params }) => json(resetDeckProgress(user.id, params.id)))
