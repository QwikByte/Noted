import { json } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { BUILD } from '@/features/updates/build'

/** Laufende Version – die App vergleicht sie mit ihrer eigenen und bietet bei Abweichung „Neu laden“ an. */
export const GET = route('user', () => json({ buildId: BUILD.buildId, version: BUILD.version }))
