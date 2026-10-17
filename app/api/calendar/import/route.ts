import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { importEvents, importSchema } from '@/features/calendar/server/events'

/** Termine aus einer .ics-Datei – gelesen und in Ortszeit umgerechnet hat sie schon der Browser */
export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, importSchema, 20 * 1024 * 1024)
  return json(importEvents(user.id, body.events))
})
