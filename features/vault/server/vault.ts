import 'server-only'
import { getDb } from '@/shared/server/db'
import { audit } from '@/shared/server/audit'
import { ApiError, badRequest, conflict, notFound } from '@/shared/server/http'
import { uuid } from '@/shared/server/crypto'
import { uniqueName } from '@/shared/lib/names'
import { VAULT_ENVELOPE_RE, VAULT_FOLDER_NAME, type VaultKdf } from '../format'
import type { VaultInfo, VaultMaterial } from '../types'

type Actor = { user: { id: number; username: string }; ip: string | null }

type VaultRow = {
  folder_id: string
  kdf: string
  wrapped_key: string
  recovery_salt: string
  recovery_wrapped_key: string
  revision: number
}

/** Klartext an einer Tresor-Notiz oder einem Tresor-Ordner – der Server verlässt sich nicht auf den Browser */
export const vaultRequired = () =>
  new ApiError(
    400,
    'vault_required',
    'Im Tresor wird nur verschlüsselt gespeichert. Entsperre den Tresor und versuche es noch einmal.',
  )

/** Verschieben über die Grenze des Tresors geht nur über den eigenen Weg (POST /api/vault/notes/[id]) */
export const vaultBoundary = () =>
  badRequest('Notizen kommen nur über „In den Tresor verschieben“ in den Tresor und wieder heraus.', 'vault_boundary')

/** Prüft nur das Muster eines Umschlags – lesen kann ihn der Server nicht */
export function assertEnvelope(value: string | undefined | null, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength || !VAULT_ENVELOPE_RE.test(value)) throw vaultRequired()
  return value
}

export function getVault(userId: number): VaultInfo | null {
  const row = getDb()
    .prepare(
      'SELECT folder_id, kdf, wrapped_key, recovery_salt, recovery_wrapped_key, revision FROM vaults WHERE user_id = ?',
    )
    .get(userId) as VaultRow | undefined
  if (!row) return null
  return {
    folderId: row.folder_id,
    kdf: JSON.parse(row.kdf) as VaultKdf,
    wrappedKey: row.wrapped_key,
    recoverySalt: row.recovery_salt,
    recoveryWrappedKey: row.recovery_wrapped_key,
    revision: row.revision,
  }
}

/** Gehört der Ordner zum Tresor? Die oberste Ebene (`null`) nie */
export function isVaultFolder(userId: number, folderId: string | null): boolean {
  if (folderId === null) return false
  const row = getDb().prepare('SELECT vault FROM folders WHERE id = ? AND user_id = ?').get(folderId, userId) as
    | { vault: number }
    | undefined
  return row?.vault === 1
}

/** Wurzelordner „Tresor“ – den kann man weder umbenennen noch verschieben oder löschen */
export function vaultRootId(userId: number): string | null {
  const row = getDb().prepare('SELECT folder_id FROM vaults WHERE user_id = ?').get(userId) as
    | { folder_id: string }
    | undefined
  return row?.folder_id ?? null
}

/** Gelöschtes auch aus dem Write-Ahead-Log in die Datenbankdatei schreiben, wo secure_delete es überschrieben hat */
export function checkpoint() {
  getDb().pragma('wal_checkpoint(TRUNCATE)')
}

export function auditVaultMove({ user, ip }: Actor, noteId: string, direction: 'in' | 'out') {
  audit({ event: 'vault_note_moved', userId: user.id, username: user.username, ip, details: { noteId, direction } })
}

/** Tresor anlegen: Wurzelordner „Tresor“ (bei Namensgleichheit „Tresor 1“ …) und das verpackte Schlüsselmaterial */
export function createVault({ user, ip }: Actor, material: VaultMaterial): VaultInfo {
  const db = getDb()
  db.transaction(() => {
    if (getVault(user.id)) throw conflict('Es gibt schon einen Tresor.', 'vault_exists')
    const taken = db.prepare('SELECT name FROM folders WHERE user_id = ? AND parent_id IS NULL').all(user.id) as {
      name: string
    }[]
    const folderId = uuid()
    const t = Date.now()
    db.prepare(
      `INSERT INTO folders (id, user_id, parent_id, name, vault, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 1, ?, ?)`,
    ).run(
      folderId,
      user.id,
      uniqueName(
        VAULT_FOLDER_NAME,
        taken.map((f) => f.name),
      ),
      t,
      t,
    )
    db.prepare(
      `INSERT INTO vaults (user_id, folder_id, kdf, wrapped_key, recovery_salt, recovery_wrapped_key, revision,
         created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      user.id,
      folderId,
      JSON.stringify(material.kdf),
      material.wrappedKey,
      material.recoverySalt,
      material.recoveryWrappedKey,
      t,
      t,
    )
  })()
  audit({ event: 'vault_created', userId: user.id, username: user.username, ip })
  return getVault(user.id)!
}

type VaultKeysPatch = {
  /** Stand, auf dem die Änderung beruht – sonst 409 (ein anderes Gerät hat inzwischen neu verpackt) */
  revision: number
  kdf?: VaultKdf
  wrappedKey?: string
  recoverySalt?: string
  recoveryWrappedKey?: string
}

/** Neues Passwort oder neuer Wiederherstellungsschlüssel: nur das verpackte Schlüsselmaterial ändert sich */
export function updateVaultKeys({ user, ip }: Actor, patch: VaultKeysPatch): VaultInfo {
  const password = patch.kdf !== undefined || patch.wrappedKey !== undefined
  const recovery = patch.recoverySalt !== undefined || patch.recoveryWrappedKey !== undefined
  if (
    (password && (!patch.kdf || !patch.wrappedKey)) ||
    (recovery && (!patch.recoverySalt || !patch.recoveryWrappedKey))
  ) {
    throw badRequest('Schlüssel und Ableitung gehören zusammen.')
  }
  if (!password && !recovery) throw badRequest('Nichts zu ändern.')
  const db = getDb()
  db.transaction(() => {
    const current = getVault(user.id)
    if (!current) throw notFound('Es gibt keinen Tresor.')
    if (current.revision !== patch.revision) {
      throw conflict(
        'Die Schlüssel des Tresors wurden inzwischen auf einem anderen Gerät geändert.',
        'revision_conflict',
        {
          vault: current,
        },
      )
    }
    db.prepare(
      `UPDATE vaults SET kdf = ?, wrapped_key = ?, recovery_salt = ?, recovery_wrapped_key = ?, revision = revision + 1,
         updated_at = ? WHERE user_id = ?`,
    ).run(
      JSON.stringify(patch.kdf ?? current.kdf),
      patch.wrappedKey ?? current.wrappedKey,
      patch.recoverySalt ?? current.recoverySalt,
      patch.recoveryWrappedKey ?? current.recoveryWrappedKey,
      Date.now(),
      user.id,
    )
  })()
  audit({ event: 'vault_keys_changed', userId: user.id, username: user.username, ip, details: { password, recovery } })
  return getVault(user.id)!
}

/**
 * Tresor löschen – ohne Tresor-Passwort, damit neu anfangen kann, wer Passwort und Wiederherstellungsschlüssel verloren
 * hat: alle Tresor-Notizen (auch im Papierkorb) samt Verlauf, die Tresor-Ordner und das Schlüsselmaterial.
 */
export function deleteVault({ user, ip }: Actor): { notes: number } {
  const db = getDb()
  if (!getVault(user.id)) throw notFound('Es gibt keinen Tresor.')
  const notes = db.transaction(() => {
    db.prepare('DELETE FROM vaults WHERE user_id = ?').run(user.id)
    // Verlauf, Freigaben, Tags und Links hängen per Fremdschlüssel an der Notiz und verschwinden mit ihr
    const removed = db.prepare('DELETE FROM notes WHERE user_id = ? AND vault = 1').run(user.id).changes
    db.prepare('DELETE FROM folders WHERE user_id = ? AND vault = 1').run(user.id)
    return removed
  })()
  checkpoint()
  audit({ event: 'vault_deleted', userId: user.id, username: user.username, ip, details: { notes } })
  return { notes }
}
