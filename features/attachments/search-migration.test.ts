import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrations } from '@/shared/server/migrations'
import { makePdf } from '@/tests/pdf'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-migrate-'))
afterAll(async () => {
  const { closeDb } = await import('@/shared/server/db')
  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('Migration Volltextsuche in Dateien', () => {
  it('ergänzt die Suche in einer bestehenden Datenbank (Version 19) und liest vorhandene Dateien nach', async () => {
    const old = new Database(path.join(dir, 'noted.db'))
    for (const sql of migrations.slice(0, 19)) old.exec(sql)
    old.pragma('user_version = 19')
    const t = Date.now()
    old
      .prepare(`INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES ('alt', 'x', 'admin', ?, ?)`)
      .run(t, t)
    const id = '33333333-3333-4333-8333-333333333333'
    const pdf = makePdf([['Deckblatt'], ['Maxwell-Gleichungen']])
    old
      .prepare(`INSERT INTO attachments (id, user_id, filename, mime, size, created_at) VALUES (?, 1, 'Skript.pdf', 'application/pdf', ?, ?)`)
      .run(id, pdf.length, t)
    old.close()
    fs.mkdirSync(path.join(dir, 'attachments', '1'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'attachments', '1', id), pdf)

    process.env.DATA_DIR = dir
    const { getDb } = await import('@/shared/server/db')
    const { indexMissing, indexPending, searchAttachments } = await import('./server/index')
    expect(getDb().pragma('user_version', { simple: true })).toBe(migrations.length)
    expect(searchAttachments(1, 'maxwell')).toEqual([])
    expect(indexMissing()).toBe(1)
    await indexPending()
    expect(searchAttachments(1, 'maxwell')).toMatchObject([{ id, filename: 'Skript.pdf', page: 2 }])
    expect(indexMissing()).toBe(0)
  })
})
