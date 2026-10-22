import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { deleteNotePermanently, getNote, trashNote, updateNote } from '@/features/notes/server/notes'
import { NOTE_FORMAT_IDS } from '@/features/notes/format'
import { MAX_VAULT_TITLE_ENVELOPE_LENGTH } from '@/features/vault/limits'

export const GET = route<{ id: string }>('user', ({ user, params }) => json({ note: getNote(user.id, params.id) }))

const schema = z.object({
  title: z.string().max(300).optional(),
  /** Nur im Tresor: verschlüsselter Titel */
  titleEnc: z.string().max(MAX_VAULT_TITLE_ENVELOPE_LENGTH).optional(),
  folderId: z.string().uuid().nullable().optional(),
  content: z.string().optional(),
  format: z.enum(NOTE_FORMAT_IDS).optional(),
  pinned: z.boolean().optional(),
  baseVersion: z.number().int().optional(),
  autoRename: z.boolean().optional(),
  /** Eigene Version überschreibt nach einem Konflikt den Server-Stand (dieser wird im Verlauf gesichert) */
  reason: z.literal('conflict').optional(),
})

export const PUT = route<{ id: string }>('user', async ({ req, user, params }) => {
  const body = await parseJson(req, schema)
  return json(updateNote(user.id, params.id, body))
})

/** In den Papierkorb verschieben – mit ?permanent=1 endgültig löschen */
export const DELETE = route<{ id: string }>('user', ({ req, user, params }) => {
  if (req.nextUrl.searchParams.get('permanent') === '1') deleteNotePermanently(user.id, params.id)
  else trashNote(user.id, params.id)
  return json({ ok: true })
})
