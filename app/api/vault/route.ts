import { z } from 'zod'
import { json, parseJson } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { createVault, deleteVault, getVault, updateVaultKeys } from '@/features/vault/server/vault'
import { kdfSchema, saltSchema, wrappedKeySchema } from '@/features/vault/format'

/** Verpacktes Schlüsselmaterial – der Service Worker hält es vor, damit Entsperren auch offline geht */
export const GET = route('user', ({ user }) => json({ vault: getVault(user.id) }))

const createSchema = z.object({
  kdf: kdfSchema,
  wrappedKey: wrappedKeySchema,
  recoverySalt: saltSchema,
  recoveryWrappedKey: wrappedKeySchema,
})

/** Tresor einrichten – mit dem im Browser erzeugten, verpackten Schlüssel */
export const POST = route('user', async ({ req, user, ip }) => {
  const body = await parseJson(req, createSchema, 16 * 1024)
  return json({ vault: createVault({ user, ip }, body) }, { status: 201 })
})

const updateSchema = z.object({
  revision: z.number().int().min(1),
  kdf: kdfSchema.optional(),
  wrappedKey: wrappedKeySchema.optional(),
  recoverySalt: saltSchema.optional(),
  recoveryWrappedKey: wrappedKeySchema.optional(),
})

/** Neues Passwort oder neuer Wiederherstellungsschlüssel (nur neu verpackt) – 409 bei veralteter revision */
export const PUT = route('user', async ({ req, user, ip }) => {
  const body = await parseJson(req, updateSchema, 16 * 1024)
  return json({ vault: updateVaultKeys({ user, ip }, body) })
})

/** Tresor samt allen Tresor-Notizen löschen – geht ohne Tresor-Passwort, lesen kann man ihn ohne nicht */
export const DELETE = route('user', ({ user, ip }) => json(deleteVault({ user, ip })))
