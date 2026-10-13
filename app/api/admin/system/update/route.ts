import { z } from 'zod'
import { ApiError, json, parseJson, route } from '@/lib/server/http'
import { audit } from '@/lib/server/audit'
import { canRequestUpdate, readUpdateRequest, requestUpdate } from '@/lib/server/update-status'

const schema = z.object({ retry: z.boolean().optional() })

/** Update-Prüfung sofort anstoßen (holt der Update-Dienst auf dem Server ab) */
export const POST = route('admin', async ({ req, user, ip }) => {
  const { retry = false } = await parseJson(req, schema)
  if (!canRequestUpdate()) {
    throw new ApiError(
      503,
      'update_unavailable',
      'Der Update-Dienst ist auf diesem Server nicht eingerichtet (siehe README, „Automatische Updates“).',
    )
  }
  requestUpdate({ retry, by: user.username })
  audit({ event: 'update_requested', actorId: user.id, actorUsername: user.username, ip, details: { retry } })
  return json({ updateRequest: readUpdateRequest() })
})
