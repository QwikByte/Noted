import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { vault } from './client/vault'
import { updateVaultNote, rememberPlain } from './client/vault-notes'
import { sync } from '@/features/notes/client/sync'
import { decryptField, encryptField, VaultError } from './crypto'
import { normalizeCrockford, VAULT_ENVELOPE_RE } from './format'
import { newPasswordError } from './components/NewPasswordFields'

const newKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])

async function codeOf(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(VaultError)
  return (err as VaultError).code
}

describe('Tresor im Browser', () => {
  afterEach(async () => {
    await vault.lock({ broadcast: false })
  })

  it('verschlüsselt nur entsperrt und zählt jedes Entsperren', async () => {
    expect(await codeOf(vault.encrypt('n1', 'title', 'x'))).toBe('locked')
    const before = vault.getSnapshot().epoch
    vault.unlockWithKey(await newKey())
    expect(vault.getSnapshot()).toMatchObject({ unlocked: true, epoch: before + 1 })
    const envelope = await vault.encrypt('n1', 'title', 'Geheim')
    expect(envelope).toMatch(VAULT_ENVELOPE_RE)
    expect(await vault.decrypt({ id: 'n1', field: 'title', envelope })).toBe('Geheim')
  })

  it('merkt sich Titel, aber keine Inhalte – und verwirft beim Sperren alles', async () => {
    vault.unlockWithKey(await newKey())
    const title = await vault.encrypt('n1', 'title', 'Titel')
    const content = await vault.encrypt('n1', 'content', 'Inhalt')
    await vault.decrypt({ id: 'n1', field: 'title', envelope: title })
    await vault.decrypt({ id: 'n1', field: 'content', envelope: content })
    expect(vault.peek({ id: 'n1', field: 'title', envelope: title })).toBe('Titel')
    expect(vault.peek({ id: 'n1', field: 'content', envelope: content })).toBeUndefined()

    await vault.lock({ broadcast: false })
    expect(vault.getSnapshot().unlocked).toBe(false)
    expect(vault.peek({ id: 'n1', field: 'title', envelope: title })).toBeUndefined()
    expect(await codeOf(vault.decrypt({ id: 'n1', field: 'title', envelope: title }))).toBe('locked')
  })

  it('erkennt vertauschte Umschläge und liefert dafür nie leeren Text', async () => {
    vault.unlockWithKey(await newKey())
    const envelope = await vault.encrypt('n1', 'content', 'Inhalt')
    expect(await codeOf(vault.decrypt({ id: 'n2', field: 'content', envelope }))).toBe('corrupt')
    expect(await codeOf(vault.decrypt({ id: 'n1', field: 'title', envelope }))).toBe('corrupt')
    // Beschädigte Titel bleiben als Fehler gemerkt – Listen zeigen „Beschädigt“
    expect(vault.peek({ id: 'n1', field: 'title', envelope })).toBeInstanceOf(VaultError)
  })

  it('sperrt erst, wenn laufende Verschlüsselungen fertig sind', async () => {
    vault.unlockWithKey(await newKey())
    const order: string[] = []
    const pending = vault.encrypt('n1', 'content', 'x'.repeat(100_000)).then(() => order.push('verschlüsselt'))
    const locked = vault.lock({ broadcast: false }).then(() => order.push('gesperrt'))
    await Promise.all([pending, locked])
    expect(order).toEqual(['verschlüsselt', 'gesperrt'])
    expect(vault.unlocked).toBe(false)
  })
})

describe('Tresor-Notizen bearbeiten', () => {
  beforeEach(() => {
    // Kein Senden an den Server – nur der Entwurf zählt
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(async () => {
    sync.discard('note-1')
    vi.useRealTimers()
    await vault.lock({ broadcast: false })
  })

  it('legt nur Umschläge in den Entwurf und verschlüsselt nur, was sich geändert hat', async () => {
    const key = await newKey()
    vault.unlockWithKey(key)
    rememberPlain('note-1', 'Titel', 'Alt')

    await updateVaultNote('note-1', 3, { content: 'Neu quokkageheimnis' })
    const first = sync.getDraft('note-1')!
    expect(first.vault).toBe(true)
    expect(first.title).toBeUndefined()
    expect(first.titleEnc).toBeUndefined()
    expect(first.content).toMatch(VAULT_ENVELOPE_RE)
    expect(await decryptField(key, 'note-1', 'content', first.content!)).toBe('Neu quokkageheimnis')

    // Gleicher Klartext: kein neuer Umschlag (sonst stiege bei jedem Speichern die Version)
    await updateVaultNote('note-1', 3, { content: 'Neu quokkageheimnis', title: 'Titel' })
    expect(sync.getDraft('note-1')!.rev).toBe(first.rev)

    await updateVaultNote('note-1', 3, { title: 'Anders quokkageheimnis' })
    const second = sync.getDraft('note-1')!
    expect(await decryptField(key, 'note-1', 'title', second.titleEnc!)).toBe('Anders quokkageheimnis')
    expect(JSON.stringify(second)).not.toContain('quokkageheimnis')
  })

  it('verschlüsselt bei einem Formatwechsel den Inhalt neu, auch wenn er gleich bleibt', async () => {
    vault.unlockWithKey(await newKey())
    rememberPlain('note-1', 'Titel', 'Text')
    await updateVaultNote('note-1', 1, { content: 'Text', format: 'text' })
    const draft = sync.getDraft('note-1')!
    expect(draft.format).toBe('text')
    expect(draft.content).toMatch(VAULT_ENVELOPE_RE)
  })

  it('verschlüsselt mit der ID als AAD – ein Umschlag passt zu keiner anderen Notiz', async () => {
    const key = await newKey()
    const envelope = await encryptField(key, 'note-1', 'content', 'x')
    await expect(decryptField(key, 'note-2', 'content', envelope)).rejects.toBeInstanceOf(VaultError)
  })
})

describe('Eingaben', () => {
  it('prüft das neue Tresor-Passwort', () => {
    expect(newPasswordError('kurz', 'kurz')).toMatch(/mindestens 12 Zeichen/)
    expect(newPasswordError('ein langer Satz', 'ein langer satz')).toBe('Die Passwörter stimmen nicht überein.')
    expect(newPasswordError('ein langer Satz', 'ein langer Satz')).toBeNull()
    // Zeichen, nicht UTF-16-Einheiten
    expect(newPasswordError('🔒'.repeat(6), '🔒'.repeat(6))).not.toBeNull()
  })

  it('vergleicht Gruppen des Wiederherstellungsschlüssels wie beim Entsperren', () => {
    expect(normalizeCrockford(' ab-o1 ')).toBe('AB01')
    expect(normalizeCrockford('il')).toBe('11')
  })
})
