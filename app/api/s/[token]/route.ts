import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getSharedNote } from '@/features/sharing/server/shares'

/** Geteilte Notiz – ohne Anmeldung, mit Rate-Limit je IP */
export const GET = route<{ token: string }>('none', ({ params, ip }) => json(getSharedNote(params.token, ip)))
