import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getCoursework } from '@/features/coursework/server/coursework'

/** Fächer und Übungsblätter – die Abgaben stehen im Kalender */
export const GET = route('user', ({ user }) => json(getCoursework(user.id)))
