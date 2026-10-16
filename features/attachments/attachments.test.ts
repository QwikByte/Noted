import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, call, loginAs, setupTestEnv } from '@/tests/helpers'
import * as attachments from '@/app/api/attachments/route'
import * as attachment from '@/app/api/attachments/[id]/route'
import * as files from '@/app/api/files/[...name]/route'

let env: Awaited<ReturnType<typeof setupTestEnv>>
let token = ''

beforeAll(async () => {
  env = await setupTestEnv()
  token = await loginAs('admin', ADMIN_PASSWORD)
})
afterAll(() => env.cleanup())

describe('Anhänge', () => {
  it('lädt Dateien hoch, vergibt eindeutige Namen und liefert sie per Name aus', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const form = new FormData()
    form.append('file', new File([png], 'Tafel:bild.png', { type: 'image/png' }))
    const r = await call(attachments.POST, '/', { cookie: token, form })
    expect(r.status).toBe(201)
    expect(r.data.attachment.filename).toBe('Tafel-bild.png')

    const form2 = new FormData()
    form2.append('file', new File([png], 'Tafel-bild.png', { type: 'image/png' }))
    const r2 = await call(attachments.POST, '/', { cookie: token, form: form2 })
    expect(r2.data.attachment.filename).toBe('Tafel-bild 1.png')

    const byName = await call(files.GET, '/', { cookie: token, params: { name: ['tafel-bild.png'] } })
    expect(byName.status).toBe(200)
    expect(byName.res.headers.get('content-type')).toBe('image/png')
    expect(byName.res.headers.get('content-security-policy')).toContain('sandbox')
    expect(new Uint8Array(await byName.res.arrayBuffer())).toEqual(png)

    const range = await call(attachment.GET, '/', {
      cookie: token,
      params: { id: r.data.attachment.id },
      headers: { range: 'bytes=1-3' },
    })
    expect(range.status).toBe(206)
    expect(new Uint8Array(await range.res.arrayBuffer())).toEqual(png.slice(1, 4))
  })

  it('übernimmt keine MIME-Typen des Browsers für unbekannte Endungen', async () => {
    const form = new FormData()
    form.append('file', new File(['alert(1)'], 'skript.js', { type: 'text/javascript' }))
    const r = await call(attachments.POST, '/', { cookie: token, form })
    expect(r.data.attachment.mime).toBe('application/octet-stream')
  })

  it('lehnt zu große Uploads ab, ohne sie komplett einzulesen', async () => {
    process.env.MAX_UPLOAD_MB = '1'
    try {
      const form = new FormData()
      form.append('file', new File([new Uint8Array(2 * 1024 * 1024)], 'gross.bin'))
      const r = await call(attachments.POST, '/', { cookie: token, form })
      expect(r.status).toBe(413)
    } finally {
      delete process.env.MAX_UPLOAD_MB
    }
  })

  it('liefert HTML-Dateien nur als Download aus', async () => {
    const form = new FormData()
    form.append('file', new File(['<script>alert(1)</script>'], 'boese.html', { type: 'text/html' }))
    const r = await call(attachments.POST, '/', { cookie: token, form })
    const get = await call(attachment.GET, '/', { cookie: token, params: { id: r.data.attachment.id } })
    expect(get.res.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(get.res.headers.get('content-type')).toBe('application/octet-stream')
  })
})
