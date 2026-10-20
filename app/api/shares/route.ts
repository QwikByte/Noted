import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { listShares } from '@/features/sharing/server/shares'

/** Alle gültigen Links des Kontos (Einstellungen → Geteilte Links) */
export const GET = route('user', ({ user }) => json({ shares: listShares(user.id) }))
