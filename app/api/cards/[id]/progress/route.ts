import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { resetCardProgress } from '@/features/flashcards/server/flashcards'

/** Karte neu lernen: Lernstand zurücksetzen und Aussetzen aufheben */
export const DELETE = route<{ id: string }>('user', ({ user, params }) => json({ card: resetCardProgress(user.id, params.id) }))
