import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { configureAi, getAiSettings, removeAi } from '@/features/ai/server/settings'
import { isAiModel, type AiModel } from '@/features/ai/models'

const schema = z.object({
  apiKey: z
    .string()
    .trim()
    .max(500, 'Der API-Schlüssel ist zu lang.')
    .regex(/^sk-ant-\S+$/, 'Das ist kein Anthropic-API-Schlüssel – er beginnt mit „sk-ant-“.')
    .optional(),
  model: z.custom<AiModel>((v) => typeof v === 'string' && isAiModel(v), 'Unbekanntes Modell.'),
})

/** KI-Einstellungen des Kontos – der Schlüssel selbst verlässt den Server nie */
export const GET = route('user', ({ user }) => json({ settings: getAiSettings(user.id) }))

/** Schlüssel hinterlegen bzw. Modell wechseln (prüft beides bei Anthropic) */
export const PUT = route('user', async ({ req, user, ip }) => {
  const body = await parseJson(req, schema, 64 * 1024)
  return json({ settings: await configureAi(user, body, ip) })
})

export const DELETE = route('user', ({ user, ip }) => json({ settings: removeAi(user, ip) }))
