import { badRequest, json, readForm } from '@/shared/server/http'
import { route } from '@/features/auth/server/route'
import { getConfig } from '@/shared/server/config'
import { isValidId } from '@/shared/server/crypto'
import { importDeckPackage } from '@/features/flashcards/server/deck-package'

/** Stapel-Datei (.noted-deck.zip) importieren – als neuer Stapel oder mit `deckId` in einen bestehenden */
export const POST = route('user', async ({ req, user }) => {
  const form = await readForm(req, getConfig().maxImportBytes + 1024 * 1024)
  const file = form.get('file')
  if (!(file instanceof File)) throw badRequest('Keine Datei übermittelt.')
  const deckId = form.get('deckId')
  const targetDeckId = typeof deckId === 'string' && isValidId(deckId) ? deckId : undefined
  return json(importDeckPackage(user.id, new Uint8Array(await file.arrayBuffer()), { targetDeckId }))
})
