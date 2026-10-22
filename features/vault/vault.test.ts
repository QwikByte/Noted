import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as vaultRoute from '@/app/api/vault/route'
import * as vaultNote from '@/app/api/vault/notes/[id]/route'
import * as notes from '@/app/api/notes/route'
import * as note from '@/app/api/notes/[id]/route'
import * as restore from '@/app/api/notes/[id]/restore/route'
import * as backlinks from '@/app/api/notes/[id]/backlinks/route'
import * as download from '@/app/api/notes/[id]/download/route'
import * as noteShares from '@/app/api/notes/[id]/shares/route'
import * as versions from '@/app/api/notes/[id]/versions/route'
import * as versionRestore from '@/app/api/notes/[id]/versions/[versionId]/restore/route'
import * as folders from '@/app/api/folders/route'
import * as folder from '@/app/api/folders/[id]/route'
import * as search from '@/app/api/search/route'
import * as tags from '@/app/api/tags/route'
import * as graph from '@/app/api/graph/route'
import * as glossary from '@/app/api/glossary/route'
import * as attachments from '@/app/api/attachments/route'
import * as exportRoute from '@/app/api/export/route'
import * as importRoute from '@/app/api/import/route'
import * as decks from '@/app/api/decks/route'
import * as deckCards from '@/app/api/decks/[id]/cards/route'
import * as users from '@/app/api/admin/users/route'
import * as adminPassword from '@/app/api/admin/users/[id]/password/route'
import * as adminMfa from '@/app/api/admin/users/[id]/mfa/route'
import * as password from '@/app/api/account/password/route'
import { createVaultMaterial, decryptField, encryptField, rewrapWithPassword, unlockWithPassword } from './crypto'
import { VAULT_ENVELOPE_RE } from './format'
import type { VaultInfo } from './types'
import type { Folder, Note, NoteSummary, NoteVersion } from '@/features/notes/types'

const MARKER = 'quokkageheimnis'
const PASSWORD = 'ein langes Tresor-Passwort'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''
let key: CryptoKey
let vault: VaultInfo

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

const id = () => crypto.randomUUID()
const enc = (target: string, field: 'title' | 'content' | 'name', text: string) =>
  encryptField(key, target, field, text)

async function vaultNoteIn(folderId: string, title: string, content: string, cookie = token) {
  const noteId = id()
  const r = await call(notes.POST, '/', {
    cookie,
    body: {
      id: noteId,
      title: noteId,
      folderId,
      titleEnc: await enc(noteId, 'title', title),
      content: await enc(noteId, 'content', content),
    },
  })
  expect(r.status, JSON.stringify(r.data)).toBe(201)
  return r.data.note as Note
}

const plainNote = async (title: string, content: string, folderId: string | null = null) =>
  (await call(notes.POST, '/', { cookie: token, body: { title, folderId, content } })).data.note as Note

describe('Tresor einrichten und Schlüssel ändern', () => {
  it('legt den Tresor an, liest ihn und lehnt einen zweiten ab', async () => {
    expect((await call(vaultRoute.GET, '/', { cookie: token })).data).toEqual({ vault: null })
    const created = await createVaultMaterial(PASSWORD)
    key = created.key
    const weak = await call(vaultRoute.POST, '/', {
      cookie: token,
      body: { ...created.material, kdf: { ...created.material.kdf, iterations: 1000 } },
    })
    expect(weak.status).toBe(400)
    const r = await call(vaultRoute.POST, '/', { cookie: token, body: created.material })
    expect(r.status).toBe(201)
    vault = r.data.vault
    expect(vault).toMatchObject({ ...created.material, revision: 1 })
    expect((await call(vaultRoute.POST, '/', { cookie: token, body: created.material })).status).toBe(409)
    expect((await call(vaultRoute.GET, '/', { cookie: token })).data.vault).toEqual(vault)
    const root = ((await call(folders.GET, '/', { cookie: token })).data.folders as Folder[]).find(
      (f) => f.id === vault.folderId,
    )
    expect(root).toMatchObject({ name: 'Tresor', parentId: null, vault: true, nameEnc: null })
  })

  it('verpackt beim Passwortwechsel nur neu – mit Prüfung der Revision', async () => {
    const rewrapped = await rewrapWithPassword(vault, { password: PASSWORD }, 'ein neues Tresor-Passwort')
    const stale = { revision: 0, ...rewrapped }
    expect((await call(vaultRoute.PUT, '/', { method: 'PUT', cookie: token, body: stale })).status).toBe(400)
    const r = await call(vaultRoute.PUT, '/', { method: 'PUT', cookie: token, body: { revision: 1, ...rewrapped } })
    expect(r.status).toBe(200)
    expect(r.data.vault.revision).toBe(2)
    const conflict = await call(vaultRoute.PUT, '/', {
      method: 'PUT',
      cookie: token,
      body: { revision: 1, ...rewrapped },
    })
    expect(conflict.status).toBe(409)
    expect(conflict.data.error).toBe('revision_conflict')
    const half = await call(vaultRoute.PUT, '/', {
      method: 'PUT',
      cookie: token,
      body: { revision: 2, kdf: rewrapped.kdf },
    })
    expect(half.status).toBe(400)
    vault = r.data.vault
    await unlockWithPassword(vault, 'ein neues Tresor-Passwort')
  })
})

describe('Notizen und Ordner im Tresor', () => {
  let sub: Folder
  let secret: Note

  it('speichert nur Umschläge und lehnt Klartext ab', async () => {
    const subId = id()
    const plainSub = await call(folders.POST, '/', { cookie: token, body: { name: MARKER, parentId: vault.folderId } })
    expect(plainSub.status).toBe(400)
    expect(plainSub.data.error).toBe('vault_required')
    const created = await call(folders.POST, '/', {
      cookie: token,
      body: { id: subId, name: subId, parentId: vault.folderId, nameEnc: await enc(subId, 'name', `Ordner ${MARKER}`) },
    })
    expect(created.status).toBe(201)
    sub = created.data.folder
    expect(sub).toMatchObject({ id: subId, name: subId, vault: true })
    expect(await decryptField(key, subId, 'name', sub.nameEnc!)).toBe(`Ordner ${MARKER}`)

    secret = await vaultNoteIn(sub.id, `Titel ${MARKER}`, `# Inhalt ${MARKER}\n#${MARKER} [[Andere]]`)
    expect(secret).toMatchObject({ title: secret.id, vault: true, excerpt: '', tags: [] })
    expect(secret.content).toMatch(VAULT_ENVELOPE_RE)
    expect(await decryptField(key, secret.id, 'content', secret.content)).toContain(`Inhalt ${MARKER}`)

    // Klartext, fehlende ID oder Klartext-Titel: abgelehnt
    const noteId = id()
    const titleEnc = await enc(noteId, 'title', 'x')
    for (const body of [
      { id: noteId, title: noteId, folderId: sub.id, titleEnc, content: MARKER },
      { title: 'x', folderId: sub.id, titleEnc, content: await enc(noteId, 'content', 'x') },
      { id: noteId, title: MARKER, folderId: sub.id, titleEnc, content: await enc(noteId, 'content', 'x') },
      { id: noteId, title: noteId, folderId: sub.id, content: await enc(noteId, 'content', 'x') },
    ]) {
      const r = await call(notes.POST, '/', { cookie: token, body })
      expect(r.status, JSON.stringify(body)).toBe(400)
      expect(r.data.error).toBe('vault_required')
    }
    // Umschlag als Titel einer normalen Notiz: kein Weg in den Tresor
    expect(
      (await call(notes.POST, '/', { cookie: token, body: { title: 'x', folderId: null, titleEnc, content: '' } }))
        .status,
    ).toBe(400)
  })

  it('ändert nur verschlüsselt und zählt einen neuen Titel als Änderung', async () => {
    const put = (body: object) => call(note.PUT, '/', { method: 'PUT', cookie: token, params: { id: secret.id }, body })
    expect((await put({ content: `Klartext ${MARKER}` })).data.error).toBe('vault_required')
    expect((await put({ title: MARKER })).data.error).toBe('vault_required')
    const titleEnc = await enc(secret.id, 'title', `Neuer Titel ${MARKER}`)
    const renamed = await put({ titleEnc, baseVersion: secret.version })
    expect(renamed.status).toBe(200)
    expect(renamed.data.note.version).toBe(secret.version + 1)
    // Alte Version, neuer Titel: Konflikt wie bei Notizen
    const stale = await put({ titleEnc: await enc(secret.id, 'title', 'anders'), baseVersion: secret.version })
    expect(stale.status).toBe(409)
    expect(stale.data.note.titleEnc).toBe(titleEnc)
    secret = renamed.data.note
  })

  it('führt den verschlüsselten Titel im Verlauf mit und stellt ihn wieder her', async () => {
    const before = secret
    const overwritten = await call(note.PUT, '/', {
      method: 'PUT',
      cookie: token,
      params: { id: secret.id },
      body: {
        titleEnc: await enc(secret.id, 'title', 'Überschrieben'),
        content: await enc(secret.id, 'content', 'überschrieben'),
        baseVersion: secret.version,
        reason: 'conflict',
      },
    })
    expect(overwritten.status).toBe(200)
    const list = (await call(versions.GET, '/', { cookie: token, params: { id: secret.id } })).data
      .versions as NoteVersion[]
    expect(list[0]).toMatchObject({ title: secret.id, titleEnc: before.titleEnc, version: before.version })
    const restored = await call(versionRestore.POST, '/', {
      cookie: token,
      params: { id: secret.id, versionId: String(list[0].id) },
    })
    expect(restored.status).toBe(200)
    expect(restored.data.note).toMatchObject({ titleEnc: before.titleEnc, content: before.content })
    secret = restored.data.note
  })

  it('lässt nichts über die Grenze verschieben – außer über den eigenen Weg', async () => {
    const plain = await plainNote('Normal', 'Text')
    const plainFolder = (
      await call(folders.POST, '/', { cookie: token, body: { name: 'Normaler Ordner', parentId: null } })
    ).data.folder as Folder
    const putNote = (noteId: string, body: object) =>
      call(note.PUT, '/', { method: 'PUT', cookie: token, params: { id: noteId }, body })
    const patchFolder = (folderId: string, body: object) =>
      call(folder.PATCH, '/', { method: 'PATCH', cookie: token, params: { id: folderId }, body })
    expect((await putNote(plain.id, { folderId: sub.id })).data.error).toBe('vault_boundary')
    expect((await putNote(secret.id, { folderId: null })).data.error).toBe('vault_boundary')
    expect((await putNote(secret.id, { folderId: plainFolder.id })).data.error).toBe('vault_boundary')
    expect((await putNote(secret.id, { folderId: vault.folderId })).status).toBe(200)
    expect((await patchFolder(plainFolder.id, { parentId: sub.id })).data.error).toBe('vault_boundary')
    expect((await patchFolder(sub.id, { parentId: null })).data.error).toBe('vault_boundary')
    expect((await patchFolder(sub.id, { name: MARKER })).data.error).toBe('vault_required')
    expect((await patchFolder(vault.folderId, { name: 'Anders' })).status).toBe(400)
    expect(
      (await call(folder.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: vault.folderId } })).status,
    ).toBe(400)
    // Umbenennen nur verschlüsselt
    const renamed = await patchFolder(sub.id, { nameEnc: await enc(sub.id, 'name', `Umbenannt ${MARKER}`) })
    expect(renamed.status).toBe(200)
    const form = new FormData()
    form.append('files', new File([`# ${MARKER}`], 'Import.md', { type: 'text/markdown' }))
    form.append('folderId', sub.id)
    expect((await call(importRoute.POST, '/', { cookie: token, form })).status).toBe(400)
    // Zurück in den Unterordner für die folgenden Tests
    expect((await putNote(secret.id, { folderId: sub.id })).status).toBe(200)
  })

  it('stellt eine Notiz aus dem Papierkorb in den Wurzelordner, wenn ihr Ordner fehlt', async () => {
    const trashed = await vaultNoteIn(sub.id, 'Weg damit', 'Inhalt')
    await call(note.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: trashed.id } })
    const tmpId = id()
    const tmp = (
      await call(folders.POST, '/', {
        cookie: token,
        body: { id: tmpId, name: tmpId, parentId: sub.id, nameEnc: await enc(tmpId, 'name', 'Kurzlebig') },
      })
    ).data.folder as Folder
    const inTmp = await vaultNoteIn(tmp.id, 'Im Unterordner', 'x')
    await call(folder.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: tmp.id } })
    const restored = await call(restore.POST, '/', { cookie: token, params: { id: inTmp.id } })
    expect(restored.data.note).toMatchObject({ folderId: vault.folderId, vault: true, title: inTmp.id })
    expect((await call(restore.POST, '/', { cookie: token, params: { id: trashed.id } })).data.note.folderId).toBe(
      sub.id,
    )
  })

  it('bleibt außerhalb von Suche, Tags, Rückverweisen, Graph, Glossar, Dateien, Teilen und Download', async () => {
    const linking = await plainNote('Verweist', `[[${secret.id}]] und [[Andere]]`)
    const responses = [
      await call(search.GET, '/', { cookie: token, query: { q: MARKER } }),
      await call(search.GET, '/', { cookie: token, query: { q: `#${MARKER}` } }),
      await call(tags.GET, '/', { cookie: token }),
      await call(graph.GET, '/', { cookie: token }),
      await call(glossary.GET, '/', { cookie: token }),
      await call(attachments.GET, '/', { cookie: token, query: { notes: '1' } }),
      await call(notes.GET, '/', { cookie: token }),
      await call(folders.GET, '/', { cookie: token }),
      await call(note.GET, '/', { cookie: token, params: { id: secret.id } }),
    ]
    for (const r of responses) expect(JSON.stringify(r.data)).not.toContain(MARKER)
    expect(responses[0].data.results).toEqual([])
    expect(JSON.stringify(responses[3].data)).not.toContain(secret.id)
    expect((await call(backlinks.GET, '/', { cookie: token, params: { id: secret.id } })).data.backlinks).toEqual([])
    const shared = await call(noteShares.POST, '/', {
      cookie: token,
      params: { id: secret.id },
      body: { expiresInDays: 7 },
    })
    expect(shared.status).toBe(400)
    expect((await call(download.GET, '/', { cookie: token, params: { id: secret.id } })).status).toBe(400)
    await call(note.DELETE, '/', {
      method: 'DELETE',
      cookie: token,
      params: { id: linking.id },
      query: { permanent: '1' },
    })
  })

  it('exportiert den Tresor nur verschlüsselt als Tresor.noted-vault und überspringt ihn beim Import', async () => {
    const r = await call(exportRoute.GET, '/', { cookie: token })
    const zip = unzipSync(new Uint8Array(await r.res.arrayBuffer()))
    const names = Object.keys(zip)
    expect(names).toContain('Tresor.noted-vault')
    expect(names.some((n) => n.includes(secret.id) || n.includes(sub.id) || /^Tresor\//.test(n))).toBe(false)
    for (const [name, data] of Object.entries(zip)) expect(strFromU8(data), name).not.toContain(MARKER)
    const file = JSON.parse(strFromU8(zip['Tresor.noted-vault']))
    expect(file).toMatchObject({ format: 'noted-vault', version: 1, rootFolderId: vault.folderId, kdf: vault.kdf })
    const exported = file.notes.find((n: { id: string }) => n.id === secret.id)
    expect(await decryptField(key, secret.id, 'title', exported.titleEnc)).toContain(MARKER)
    expect(file.folders.find((f: { id: string }) => f.id === sub.id).nameEnc).toMatch(VAULT_ENVELOPE_RE)

    const form = new FormData()
    form.append(
      'files',
      new File([zipSync({ 'Tresor.noted-vault': strToU8('{}'), 'Notiz.md': strToU8('Hallo') })], 'Export.zip'),
    )
    const imported = await call(importRoute.POST, '/', { cookie: token, form })
    expect(imported.data.notes).toBe(1)
    expect(imported.data.skipped).toEqual(['Tresor.noted-vault (der Tresor lässt sich noch nicht importieren)'])
  })
})

describe('Verschieben über die Grenze', () => {
  it('nimmt einer Notiz im Tresor Verlauf, Freigaben, Index, Tags und Links – bis in die Datei', async () => {
    const plain = await plainNote(`Klar ${MARKER}`, `Text ${MARKER} #${MARKER} [[Ziel ${MARKER}]]`)
    // Ein Stand im Verlauf und eine Freigabe, beide mit Klartext
    const v2 = await call(note.PUT, '/', {
      method: 'PUT',
      cookie: token,
      params: { id: plain.id },
      body: { content: `Neu ${MARKER}`, baseVersion: plain.version, reason: 'conflict' },
    })
    expect(
      (await call(noteShares.POST, '/', { cookie: token, params: { id: plain.id }, body: { expiresInDays: 7 } }))
        .status,
    ).toBe(201)
    const deck = (await call(decks.POST, '/', { cookie: token, body: { name: 'Stapel' } })).data.deck
    await call(deckCards.POST, '/', {
      cookie: token,
      params: { id: deck.id },
      body: { cards: [{ type: 'basic', front: 'Frage', back: 'Antwort', noteId: plain.id }] },
    })
    expect((await call(search.GET, '/', { cookie: token, query: { q: MARKER } })).data.results).toHaveLength(1)

    const move = async (baseVersion: number) =>
      call(vaultNote.POST, '/', {
        cookie: token,
        params: { id: plain.id },
        body: {
          action: 'move-in',
          folderId: vault.folderId,
          baseVersion,
          titleEnc: await enc(plain.id, 'title', `Klar ${MARKER}`),
          content: await enc(plain.id, 'content', `Neu ${MARKER}`),
          deleteCards: true,
        },
      })
    expect((await move(plain.version)).status).toBe(409)
    const moved = await move(v2.data.note.version)
    expect(moved.status).toBe(200)
    expect(moved.data.cards).toBe(1)
    expect(moved.data.note).toMatchObject({
      vault: true,
      title: plain.id,
      tags: [],
      excerpt: '',
      folderId: vault.folderId,
    })
    expect((await call(versions.GET, '/', { cookie: token, params: { id: plain.id } })).data.versions).toEqual([])
    expect((await call(noteShares.GET, '/', { cookie: token, params: { id: plain.id } })).data.shares).toEqual([])
    expect((await call(search.GET, '/', { cookie: token, query: { q: MARKER } })).data.results).toEqual([])
    expect(JSON.stringify((await call(tags.GET, '/', { cookie: token })).data)).not.toContain(MARKER)

    // Rohbytes der Datenbank: secure_delete, FTS5 secure-delete und der Checkpoint lassen keinen Klartext zurück
    for (const file of ['noted.db', 'noted.db-wal']) {
      const p = path.join(env.dir, file)
      if (fs.existsSync(p)) expect(fs.readFileSync(p).includes(Buffer.from(MARKER)), file).toBe(false)
    }
  })

  it('macht eine Notiz beim Verschieben aus dem Tresor wieder durchsuchbar', async () => {
    const inside = await vaultNoteIn(vault.folderId, 'Zurück', 'Wieder sichtbar')
    await plainNote('Zurück', 'Gleicher Titel schon da')
    const r = await call(vaultNote.POST, '/', {
      cookie: token,
      params: { id: inside.id },
      body: {
        action: 'move-out',
        folderId: null,
        baseVersion: inside.version,
        title: 'Zurück',
        content: 'Wieder sichtbar',
      },
    })
    expect(r.status).toBe(200)
    expect(r.data.note).toMatchObject({
      vault: false,
      title: 'Zurück 1',
      titleEnc: null,
      folderId: null,
      content: 'Wieder sichtbar',
    })
    const found = (await call(search.GET, '/', { cookie: token, query: { q: 'sichtbar' } })).data.results
    expect(found.map((n: NoteSummary) => n.id)).toContain(inside.id)
    const again = await call(vaultNote.POST, '/', {
      cookie: token,
      params: { id: inside.id },
      body: { action: 'move-out', folderId: null, baseVersion: r.data.note.version, title: 'x', content: 'x' },
    })
    expect(again.status).toBe(400)
  })
})

describe('Zugriff anderer', () => {
  it('zeigt einem anderen Konto nichts und nach einem Admin-Reset nur Umschläge', async () => {
    await call(users.POST, '/api/admin/users', {
      cookie: token,
      body: { username: 'zweite', password: 'Start-Kennwort-123' },
    })
    const first = await loginAs('zweite', 'Start-Kennwort-123')
    await call(password.POST, '/', {
      cookie: first,
      body: { currentPassword: 'Start-Kennwort-123', newPassword: 'Eigenes-Kennwort-456' },
    })
    let other = await loginAs('zweite', 'Eigenes-Kennwort-456')
    const otherId = (await call(users.GET, '/', { cookie: token })).data.users.find(
      (u: { username: string }) => u.username === 'zweite',
    ).id

    // Das zweite Konto richtet einen eigenen Tresor ein
    const material = await createVaultMaterial('Passwort des zweiten Kontos')
    const own = (await call(vaultRoute.POST, '/', { cookie: other, body: material.material })).data.vault as VaultInfo
    const noteId = id()
    const created = await call(notes.POST, '/', {
      cookie: other,
      body: {
        id: noteId,
        title: noteId,
        folderId: own.folderId,
        titleEnc: await encryptField(material.key, noteId, 'title', 'Privat'),
        content: await encryptField(material.key, noteId, 'content', `Tagebuch ${MARKER}`),
      },
    })
    expect(created.status).toBe(201)
    // Das Admin-Konto sieht davon nichts
    expect((await call(note.GET, '/', { cookie: token, params: { id: noteId } })).status).toBe(404)
    expect(
      (await call(note.PUT, '/', { method: 'PUT', cookie: token, params: { id: noteId }, body: { pinned: true } }))
        .status,
    ).toBe(404)
    expect((await call(vaultRoute.GET, '/', { cookie: other })).data.vault.folderId).not.toBe(vault.folderId)

    // Admin setzt Passwort und MFA zurück und meldet sich an: nur Umschläge, kein Schlüssel
    await call(adminPassword.POST, '/', {
      cookie: token,
      params: { id: String(otherId) },
      body: { password: 'Admin-Gesetzt-789' },
    })
    await call(adminMfa.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: String(otherId) } })
    const taken = await loginAs('zweite', 'Admin-Gesetzt-789')
    await call(password.POST, '/', {
      cookie: taken,
      body: { currentPassword: 'Admin-Gesetzt-789', newPassword: 'Uebernommen-Kennwort-1' },
    })
    other = await loginAs('zweite', 'Uebernommen-Kennwort-1')
    const seen = await call(note.GET, '/', { cookie: other, params: { id: noteId } })
    expect(seen.data.note.content).toMatch(VAULT_ENVELOPE_RE)
    expect(JSON.stringify(seen.data)).not.toContain(MARKER)
    expect(JSON.stringify((await call(vaultRoute.GET, '/', { cookie: other })).data)).not.toContain(MARKER)
  })
})

describe('Tresor löschen', () => {
  it('entfernt alle Tresor-Notizen (auch im Papierkorb), Ordner, Verlauf und Schlüssel', async () => {
    const list = (await call(notes.GET, '/', { cookie: token })).data.notes as NoteSummary[]
    const vaultNotes = list.filter((n) => n.vault).map((n) => n.id)
    expect(vaultNotes.length).toBeGreaterThan(0)
    await call(note.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: vaultNotes[0] } })
    const r = await call(vaultRoute.DELETE, '/', { method: 'DELETE', cookie: token })
    expect(r.status).toBe(200)
    expect(r.data.notes).toBeGreaterThanOrEqual(vaultNotes.length)
    expect((await call(vaultRoute.GET, '/', { cookie: token })).data.vault).toBeNull()
    expect(((await call(notes.GET, '/', { cookie: token })).data.notes as NoteSummary[]).some((n) => n.vault)).toBe(
      false,
    )
    expect(((await call(folders.GET, '/', { cookie: token })).data.folders as Folder[]).some((f) => f.vault)).toBe(
      false,
    )
    const { getDb } = await import('@/shared/server/db')
    const count = (sql: string) => (getDb().prepare(sql).get(1) as { n: number }).n
    expect(count('SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND vault = 1')).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM note_versions WHERE user_id = ? AND title_enc IS NOT NULL')).toBe(0)
    expect((await call(vaultRoute.DELETE, '/', { method: 'DELETE', cookie: token })).status).toBe(404)
  })
})
