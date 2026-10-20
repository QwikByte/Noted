import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import { makePdf } from '@/tests/pdf'
import * as attachments from '@/app/api/attachments/route'
import * as attachment from '@/app/api/attachments/[id]/route'
import * as annotationsRoute from '@/app/api/attachments/[id]/annotations/route'
import * as annotationRoute from '@/app/api/attachments/[id]/annotations/[annotationId]/route'
import * as exportRoute from '@/app/api/export/route'
import * as importRoute from '@/app/api/import/route'
import * as users from '@/app/api/admin/users/route'
import * as password from '@/app/api/account/password/route'
import { getDb } from '@/shared/server/db'
import { MAX_ANNOTATIONS_PER_REQUEST, MAX_COMMENT, MAX_QUOTE, MAX_RECTS } from './limits'
import type { PdfAnnotation } from './types'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''
/** Zeitpunkte relativ zu einem festen Tag */
const T = Date.UTC(2026, 9, 1)

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

async function upload(name: string, data: Uint8Array, cookie = token) {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(data)], name))
  const r = await call(attachments.POST, '/', { cookie, form })
  expect(r.status).toBe(201)
  return r.data.attachment as { id: string; filename: string }
}

function annotation(over: Partial<PdfAnnotation> = {}): Omit<PdfAnnotation, 'attachmentId'> {
  return {
    id: crypto.randomUUID(),
    page: 1,
    rects: [[60, 750, 300, 776]],
    quote: 'Erster Hauptsatz',
    comment: '',
    color: 3,
    createdAt: T + 1_000,
    updatedAt: T + 1_000,
    ...over,
  }
}

const list = (id: string, cookie = token) => call(annotationsRoute.GET, '/', { cookie, params: { id } })
const save = (id: string, annotations: unknown[], cookie = token) =>
  call(annotationsRoute.PUT, '/', { method: 'PUT', cookie, params: { id }, body: { annotations } })
const remove = (id: string, annotationId: string, cookie = token) =>
  call(annotationRoute.DELETE, '/', { method: 'DELETE', cookie, params: { id, annotationId } })

describe('Anmerkungen in PDFs', () => {
  it('legt Markierungen an und ändert sie per PUT mit gleicher ID – ohne Dubletten', async () => {
    const pdf = await upload('Thermo.pdf', makePdf([['Thermodynamik'], ['Zweiter Hauptsatz']]))
    const first = annotation({ comment: 'Prüfungsrelevant' })
    const second = annotation({ page: 2, rects: [[60, 750, 200, 776], [60, 724, 180, 742]], createdAt: T + 2_000, updatedAt: T + 2_000 })
    expect((await save(pdf.id, [first, second])).data).toEqual({ saved: 2 })
    // Offline gesammelte werden womöglich doppelt gesendet
    expect((await save(pdf.id, [first])).status).toBe(200)

    let r = await list(pdf.id)
    expect(r.status).toBe(200)
    expect(r.data.annotations).toEqual([
      { ...first, attachmentId: pdf.id },
      { ...second, attachmentId: pdf.id },
    ])

    // Neuerer Stand gewinnt, ein älterer (z. B. von einem Gerät, das lange offline war) ändert nichts mehr
    await save(pdf.id, [{ ...first, comment: '  Neu  ', color: 1, updatedAt: T + 5_000 }])
    await save(pdf.id, [{ ...first, comment: 'Veraltet', updatedAt: T + 4_000 }])
    r = await list(pdf.id)
    expect(r.data.annotations[0]).toMatchObject({ id: first.id, comment: 'Neu', color: 1, updatedAt: T + 5_000, createdAt: T + 1_000 })
    expect(r.data.annotations).toHaveLength(2)

    expect((await remove(pdf.id, second.id)).status).toBe(200)
    expect((await remove(pdf.id, second.id)).status).toBe(404)
    expect((await list(pdf.id)).data.annotations.map((a: PdfAnnotation) => a.id)).toEqual([first.id])
  })

  it('prüft Grenzwerte mit verständlichen Meldungen', async () => {
    const pdf = await upload('Grenzen.pdf', makePdf([['Seite']]))
    const cases: [unknown, string][] = [
      [annotation({ quote: 'x'.repeat(MAX_QUOTE + 1) }), 'Der markierte Text ist zu lang (höchstens 2.000 Zeichen).'],
      [annotation({ comment: 'x'.repeat(MAX_COMMENT + 1) }), 'Der Kommentar ist zu lang (höchstens 5.000 Zeichen).'],
      [annotation({ rects: [] }), 'Eine Markierung braucht mindestens eine Textzeile.'],
      [annotation({ rects: Array.from({ length: MAX_RECTS + 1 }, () => [0, 0, 1, 1]) }), 'Eine Markierung darf höchstens 50 Zeilen umfassen.'],
      [{ ...annotation(), rects: [[0, 0, 1]] }, 'Ungültige Position einer Markierung.'],
      [{ ...annotation(), rects: [[0, 0, 1, 'x']] }, 'Ungültige Position einer Markierung.'],
      [{ ...annotation(), color: 7 }, 'Unbekannte Farbe.'],
      [{ ...annotation(), id: 'keine-uuid' }, 'Ungültige ID einer Anmerkung.'],
      [{ ...annotation(), page: 0 }, 'Ungültige Seite.'],
      [{ ...annotation(), updatedAt: 1_000 }, 'Ungültiger Zeitpunkt.'],
    ]
    for (const [input, message] of cases) {
      const r = await save(pdf.id, [input])
      expect(r.status, message).toBe(400)
      expect(r.data.message).toBe(message)
    }
    const many = Array.from({ length: MAX_ANNOTATIONS_PER_REQUEST + 1 }, () => annotation())
    const r = await save(pdf.id, many)
    expect(r.status).toBe(400)
    expect(r.data.message).toMatch(/^Höchstens 500 Anmerkungen auf einmal/)
    expect((await list(pdf.id)).data.annotations).toEqual([])
  })

  it('gibt es nur für PDFs', async () => {
    const png = await upload('Bild.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const r = await save(png.id, [annotation()])
    expect(r.status).toBe(400)
    expect(r.data.message).toBe('Anmerkungen gibt es nur in PDF-Dateien.')
  })

  it('verweigert fremde PDFs und lässt fremde IDs unberührt', async () => {
    const pdf = await upload('Privat.pdf', makePdf([['Geheim']]))
    const mine = annotation({ comment: 'Meins' })
    await save(pdf.id, [mine])

    await call(users.POST, '/api/admin/users', { cookie: token, body: { username: 'zweitnutzer', password: 'Zweit-Kennwort-1' } })
    const first = await loginAs('zweitnutzer', 'Zweit-Kennwort-1')
    await call(password.POST, '/', { cookie: first, body: { currentPassword: 'Zweit-Kennwort-1', newPassword: 'Zweit-Kennwort-2' } })
    const other = await loginAs('zweitnutzer', 'Zweit-Kennwort-2')

    expect((await list(pdf.id, other)).status).toBe(404)
    expect((await save(pdf.id, [annotation()], other)).status).toBe(404)
    expect((await remove(pdf.id, mine.id, other)).status).toBe(404)

    // Gleiche ID an eigenem PDF ändert die fremde Anmerkung nicht
    const own = await upload('Eigenes.pdf', makePdf([['Offen']]), other)
    expect((await save(own.id, [{ ...mine, comment: 'Gekapert', updatedAt: T + 9_000 }], other)).data).toEqual({ saved: 0 })
    expect((await list(own.id, other)).data.annotations).toEqual([])
    expect((await list(pdf.id)).data.annotations[0].comment).toBe('Meins')
  })

  it('löscht die Anmerkungen mit dem Anhang', async () => {
    const pdf = await upload('Weg.pdf', makePdf([['Bald weg']]))
    await save(pdf.id, [annotation(), annotation()])
    const count = () =>
      (getDb().prepare('SELECT COUNT(*) AS n FROM pdf_annotations WHERE attachment_id = ?').get(pdf.id) as { n: number }).n
    expect(count()).toBe(2)
    expect((await call(attachment.DELETE, '/', { method: 'DELETE', cookie: token, params: { id: pdf.id } })).status).toBe(200)
    expect(count()).toBe(0)
  })

  it('exportiert die Markierungen als lesbare Markdown-Datei neben dem PDF – der Import übergeht sie', async () => {
    const pdf = await upload('Skript.pdf', makePdf([['Kapitel 1'], ['Kapitel 2']]))
    await save(pdf.id, [
      annotation({ page: 2, quote: 'Entropie nimmt zu', comment: 'Beispiel merken', createdAt: T + 2_000 }),
      annotation({ page: 1, quote: 'Energie bleibt erhalten', createdAt: T + 3_000 }),
    ])
    const r = await call(exportRoute.GET, '/', { cookie: token })
    const zip = unzipSync(new Uint8Array(await r.res.arrayBuffer()))
    expect(strFromU8(zip['Anhänge/Skript.pdf.anmerkungen.md'])).toBe(
      [
        '# Anmerkungen zu Skript.pdf',
        '',
        '## Seite 1',
        '',
        '> Energie bleibt erhalten',
        '',
        '## Seite 2',
        '',
        '> Entropie nimmt zu',
        '',
        'Beispiel merken',
        '',
      ].join('\n'),
    )
    // PDFs ohne Markierungen bekommen keine Datei
    expect(zip['Anhänge/Grenzen.pdf']).toBeDefined()
    expect(zip['Anhänge/Grenzen.pdf.anmerkungen.md']).toBeUndefined()

    const form = new FormData()
    form.append('files', new File([await (await call(exportRoute.GET, '/', { cookie: token })).res.arrayBuffer()], 'export.zip'))
    const imported = await call(importRoute.POST, '/', { cookie: token, form })
    expect(imported.status).toBe(200)
    const titles = getDb().prepare('SELECT title FROM notes WHERE user_id = 1').all() as { title: string }[]
    expect(titles.map((t) => t.title)).not.toContain('Skript.pdf.anmerkungen')
  })
})
