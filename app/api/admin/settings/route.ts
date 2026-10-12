import { z } from 'zod'
import { json, parseJson, route } from '@/lib/server/http'
import { getSettings, updateSettings } from '@/lib/server/settings'
import { audit } from '@/lib/server/audit'

export const GET = route('admin', () => json({ settings: getSettings() }))

const schema = z.object({ enforceMfa: z.boolean().optional() })

export const PATCH = route('admin', async ({ req, user, ip }) => {
  const body = await parseJson(req, schema)
  updateSettings(body)
  audit({ event: 'settings_changed', actorId: user.id, actorUsername: user.username, ip, details: body })
  return json({ settings: getSettings() })
})
