import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { createNote, listNotes } from '@/features/notes/server/notes'
import { NOTE_FORMAT_IDS } from '@/features/notes/format'
import { MAX_VAULT_TITLE_ENVELOPE_LENGTH } from '@/features/vault/limits'

export const GET = route('user', ({ user }) => json({ notes: listNotes(user.id) }))

const schema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().max(300),
  folderId: z.string().uuid().nullable().default(null),
  content: z.string().default(''),
  format: z.enum(NOTE_FORMAT_IDS).default('markdown'),
  pinned: z.boolean().optional(),
  /** Nur im Tresor: verschlüsselter Titel (dann ist `content` ein Umschlag) */
  titleEnc: z.string().max(MAX_VAULT_TITLE_ENVELOPE_LENGTH).optional(),
})

export const POST = route('user', async ({ req, user }) => {
  const body = await parseJson(req, schema)
  return json({ note: createNote(user.id, body) }, { status: 201 })
})
