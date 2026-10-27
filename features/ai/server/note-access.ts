import 'server-only'
import { getNote } from '@/features/notes/server/notes'
import { ApiError, badRequest } from '@/shared/server/http'

/**
 * Nur Notizen, die der Server kennt und die nicht im Tresor liegen, gehen an Claude. Eine unbekannte könnte eine offline
 * angelegte Tresor-Notiz sein – deren Klartext darf nicht hinaus.
 */
export function checkNoteForAi(userId: number, noteId: string) {
  let vault: boolean
  try {
    vault = getNote(userId, noteId).vault
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw badRequest('Die Notiz ist noch nicht auf dem Server. Warte kurz, bis sie synchronisiert ist.', 'not_synced')
    }
    throw err
  }
  if (vault) throw badRequest('Notizen aus dem Tresor gehen nicht an Claude.', 'vault')
}
