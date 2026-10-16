import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as notes from '@/app/api/notes/route'
import * as folders from '@/app/api/folders/route'
import * as attachments from '@/app/api/attachments/route'
import * as exportRoute from '@/app/api/export/route'
import * as importRoute from '@/app/api/import/route'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

async function newFolder(name: string, parentId: string | null = null) {
  const r = await call(folders.POST, '/api/folders', { cookie: token, body: { name, parentId } })
  expect(r.status).toBe(201)
  return r.data.folder as { id: string; name: string }
}

async function newNote(title: string, content = '', folderId: string | null = null) {
  const r = await call(notes.POST, '/api/notes', { cookie: token, body: { title, content, folderId } })
  expect(r.status).toBe(201)
  return r.data.note as { id: string; title: string; version: number; tags: string[] }
}

describe('Export und Import (Obsidian-Vault)', () => {
  it('exportiert Notizen mit Ordnerstruktur und Anhängen als ZIP', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'Tafel-bild.png', { type: 'image/png' }))
    expect((await call(attachments.POST, '/', { cookie: token, form })).status).toBe(201)
    const sem = await newFolder('Export Semester')
    const fach = await newFolder('Fach', sem.id)
    await newNote('Skript', 'Bild: ![[Tafel-bild.png]]', fach.id)
    await newFolder('Leer')
    const r = await call(exportRoute.GET, '/', { cookie: token })
    expect(r.res.headers.get('content-type')).toBe('application/zip')
    const zip = unzipSync(new Uint8Array(await r.res.arrayBuffer()))
    expect(strFromU8(zip['Export Semester/Fach/Skript.md'])).toBe('Bild: ![[Tafel-bild.png]]')
    expect(zip['Anhänge/Tafel-bild.png']).toBeDefined()
    expect(Object.keys(zip)).toContain('Leer/')
  })

  it('importiert ein Vault-ZIP inkl. Ordnern und überspringt .obsidian', async () => {
    const vault = zipSync({
      'Mein Vault/Uni/Mathe.md': strToU8('# Mathe\n#import'),
      'Mein Vault/Uni/bild.jpg': new Uint8Array([1, 2, 3]),
      'Mein Vault/.obsidian/app.json': strToU8('{}'),
      'Mein Vault/Notiz:mit:Doppelpunkt.md': strToU8('x'),
    })
    const form = new FormData()
    form.append('files', new File([vault], 'vault.zip', { type: 'application/zip' }))
    form.append('files', new File(['Einzeln'], 'Einzelne Datei.md'))
    const r = await call(importRoute.POST, '/', { cookie: token, form })
    expect(r.status).toBe(200)
    expect(r.data).toMatchObject({ notes: 3, attachments: 1, folders: 2 })
    const list = await call(notes.GET, '/', { cookie: token })
    const titles = list.data.notes.map((n: { title: string }) => n.title)
    expect(titles).toEqual(expect.arrayContaining(['Mathe', 'Notiz-mit-Doppelpunkt', 'Einzelne Datei']))
    const mathe = list.data.notes.find((n: { title: string }) => n.title === 'Mathe')
    expect(mathe.tags).toEqual(['import'])
  })

  it('überspringt zu große Einträge im ZIP, ohne sie zu entpacken', async () => {
    process.env.MAX_UPLOAD_MB = '1'
    try {
      const vault = zipSync({ 'klein.md': strToU8('ok'), 'riesig.bin': new Uint8Array(3 * 1024 * 1024) })
      const form = new FormData()
      form.append('files', new File([vault], 'v.zip'))
      const r = await call(importRoute.POST, '/', { cookie: token, form })
      expect(r.status).toBe(200)
      expect(r.data.notes).toBe(1)
      expect(r.data.skipped).toEqual(['riesig.bin (zu groß)'])
    } finally {
      delete process.env.MAX_UPLOAD_MB
    }
  })

  it('lehnt kaputte ZIP-Dateien ab', async () => {
    const form = new FormData()
    form.append('files', new File([new Uint8Array([1, 2, 3])], 'kaputt.zip'))
    const r = await call(importRoute.POST, '/', { cookie: token, form })
    expect(r.status).toBe(400)
  })
})
