import { json, route } from '@/lib/server/http'
import { BUILD } from '@/lib/shared/build'

/** Laufende Version – die App vergleicht sie mit ihrer eigenen und bietet bei Abweichung „Neu laden“ an. */
export const GET = route('user', () => json({ buildId: BUILD.buildId, version: BUILD.version }))
