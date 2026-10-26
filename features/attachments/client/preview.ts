'use client'
// Vorschauen, einmal gerendert und im Browser aufbewahrt: im Bereich „Dateien“ die erste Seite von PDFs und kleine
// Bilder (statt der Bilder in voller Größe im Offline-Speicher), eingebettete PDF-Seiten in Notizen und Karteikarten
// (![[Skript.pdf#page=3]])
import { useEffect, useState } from 'react'
import { fetchPdf, renderPdfData, renderPdfDataPages } from '@/features/pdf/client/pdfjs'
import { inTurns } from '@/shared/lib/in-turns'
import type { Attachment } from '../types'

/** Beginnt mit „noted-data“, damit die Vorschauen beim Abmelden wie die übrigen Offline-Daten gelöscht werden */
const CACHE = 'noted-data-previews'
/** Breite in Pixeln – auch Folien im Querformat bleiben in der Karte auf hochauflösenden Bildschirmen scharf */
const WIDTH = 640
/** Breite eingebetteter Seiten – Schrift auf Folien und Formeln soll lesbar bleiben */
const PAGE_WIDTH = 1200
/** Breite der Vorschau eines Bilds – die Karte ist klein, auch auf hochauflösenden Bildschirmen scharf genug */
const IMAGE_WIDTH = 480
/** PDFs, die gleichzeitig geladen und gerendert werden – sonst holt ein voller Ordner alle Dateien auf einmal */
const PARALLEL = 2

/** Schlüssel im Cache – nur ein Name, unter der Adresse antwortet der Server nicht. Seiten unter /previews/<id>/<seite> */
const cacheKey = (id: string, page?: number) => `/previews/${id}${page ? `/${page}` : ''}`

/** Nach Cache-Schlüssel */
const previews = new Map<string, Promise<string | null>>()
/** Fertige Vorschauen: erscheinen beim erneuten Öffnen eines Ordners sofort */
const ready = new Map<string, string>()

const inTurn = inTurns(PARALLEL)

async function openCache(): Promise<Cache | null> {
  try {
    // Ohne HTTPS (z. B. im Heimnetz über eine IP-Adresse) gibt es keinen Cache – dann wird jedes Mal gerendert
    return 'caches' in window ? await caches.open(CACHE) : null
  } catch {
    return null
  }
}

/**
 * Datei für die Vorschau laden. Mit „Range“ legt der Service Worker sie nicht im Offline-Speicher ab – sonst landete
 * dort jedes PDF, das man hier nur sieht. Offline kommt sie von dort, falls sie schon einmal geöffnet wurde.
 */
async function loadPdf(file: Pick<Attachment, 'id' | 'filename'>): Promise<Uint8Array> {
  try {
    const res = await fetch(`/api/attachments/${file.id}`, { credentials: 'same-origin', headers: { range: 'bytes=0-' } })
    if (res.ok) return new Uint8Array(await res.arrayBuffer())
  } catch {
    // offline – weiter unten aus dem Offline-Speicher
  }
  return fetchPdf(file.filename)
}

/** Bild aus dem Cache – sonst erzeugen und ablegen. Der Inhalt einer Datei ändert sich nie (neue Datei = neue ID). */
async function cachedImage(key: string, make: () => Promise<Blob>): Promise<string> {
  const cache = await openCache()
  let blob = await cache?.match(key).then((r) => r?.blob())
  if (!blob) {
    blob = await make()
    void cache?.put(key, new Response(blob, { headers: { 'content-type': blob.type } })).catch(() => {})
  }
  const url = URL.createObjectURL(blob)
  ready.set(key, url)
  return url
}

/** Je Schlüssel nur einmal erzeugen – null, wenn es nicht geht */
function remembered(key: string, make: () => Promise<Blob>): Promise<string | null> {
  let p = previews.get(key)
  if (!p) {
    p = cachedImage(key, make).catch(() => {
      // Offline und noch nie geöffnet: beim nächsten Mal erneut versuchen. Sonst (beschädigt, Passwort, keine solche
      // Seite) bleibt es für diese Sitzung beim Symbol bzw. bei der Karte
      if (!navigator.onLine) previews.delete(key)
      return null
    })
    previews.set(key, p)
  }
  return p
}

const pdfPreview = (file: Pick<Attachment, 'id' | 'filename'>) =>
  remembered(cacheKey(file.id), async () => (await inTurn(async () => renderPdfData(await loadPdf(file), 1, WIDTH, 'image/jpeg'))).blob)

/** Verkleinertes Bild – geladen mit „Range“, damit der Service Worker das Original nicht offline ablegt */
async function renderImage(file: Pick<Attachment, 'id' | 'mime'>): Promise<Blob> {
  const res = await fetch(`/api/attachments/${file.id}`, { credentials: 'same-origin', headers: { range: 'bytes=0-' } })
  if (!res.ok) throw new Error(`Bild nicht geladen (${res.status})`)
  const blob = await res.blob()
  // Vektorgrafik: keine Pixel zum Verkleinern
  if (file.mime === 'image/svg+xml') return blob
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, IMAGE_WIDTH / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')!
  // Durchsichtige Stellen weiß statt schwarz (JPEG kennt keine Transparenz)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const small = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
  if (!small) throw new Error('Vorschau nicht erzeugt')
  return small
}

const imagePreview = (file: Pick<Attachment, 'id' | 'mime'>) => remembered(cacheKey(file.id), () => inTurn(() => renderImage(file)))

type PageRequest = { resolve: (blob: Blob) => void; reject: (err: unknown) => void }
/** Seiten, die gerade aus demselben PDF angefordert werden – die Datei wird für alle zusammen einmal geladen und geöffnet */
const batches = new Map<string, { file: Pick<Attachment, 'id' | 'filename'>; pages: Map<number, PageRequest[]> }>()

function renderPage(file: Pick<Attachment, 'id' | 'filename'>, page: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let batch = batches.get(file.id)
    if (!batch) {
      const created = { file, pages: new Map<number, PageRequest[]>() }
      batches.set(file.id, created)
      batch = created
      // Alle Seiten einsammeln, die beim selben Rendern der Notiz angefragt werden
      setTimeout(() => {
        batches.delete(file.id)
        void renderBatch(created)
      }, 0)
    }
    batch.pages.set(page, [...(batch.pages.get(page) ?? []), { resolve, reject }])
  })
}

async function renderBatch({ file, pages }: { file: Pick<Attachment, 'id' | 'filename'>; pages: Map<number, PageRequest[]> }) {
  try {
    const { images } = await inTurn(async () => renderPdfDataPages(await loadPdf(file), [...pages.keys()], PAGE_WIDTH, 'image/jpeg'))
    for (const [page, requests] of pages) {
      const image = images.get(page)
      for (const r of requests) {
        if (image instanceof Blob) r.resolve(image)
        else r.reject(image)
      }
    }
  } catch (err) {
    for (const requests of pages.values()) for (const r of requests) r.reject(err)
  }
}

/**
 * Eingebettete PDF-Seiten (Platzhalter `a.embed-pdf-page` aus dem Markdown) in `root` durch ihr Bild ersetzen – der Link
 * bleibt, ein Klick öffnet weiter den Viewer. Fehlt die Datei oder die Seite, bleibt die Karte. Fertig, wenn alle
 * Bilder da sind oder feststeht, dass es keins gibt (für den Druck).
 */
export async function renderPdfPageImages(root: HTMLElement, files: () => Promise<Pick<Attachment, 'id' | 'filename'>[]>) {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a.embed-pdf-page:not([data-rendered])'))
  if (links.length === 0) return
  for (const a of links) a.dataset.rendered = '1'
  let list: Pick<Attachment, 'id' | 'filename'>[]
  try {
    list = await files()
  } catch {
    return
  }
  await Promise.all(
    links.map(async (a) => {
      const name = (a.dataset.pdf ?? '').split('/').pop()!.toLowerCase()
      const page = Number(a.dataset.page)
      const file = list.find((f) => f.filename.toLowerCase() === name)
      if (!file || !page) return
      const url = await remembered(cacheKey(file.id, page), () => renderPage(file, page))
      if (!url || !a.isConnected) return
      const img = document.createElement('img')
      img.src = url
      img.alt = `${file.filename}, Seite ${page}`
      const width = Number(a.dataset.width)
      if (width) img.style.width = `${width}px`
      await img.decode().catch(() => {})
      a.replaceChildren(img)
      a.classList.add('embed-pdf-page-image')
    }),
  )
}

/**
 * Bildadresse der Vorschau (erste Seite eines PDFs, verkleinertes Bild) – sobald `ref` in die Nähe des sichtbaren
 * Bereichs kommt; null, solange sie fehlt oder sich nicht erzeugen lässt.
 */
export function useFilePreview(ref: React.RefObject<Element | null>, file: Pick<Attachment, 'id' | 'filename' | 'mime'>): string | null {
  const [visible, setVisible] = useState(false)
  const [url, setUrl] = useState<string | null>(() => ready.get(cacheKey(file.id)) ?? null)
  const { id, filename, mime } = file

  useEffect(() => {
    const el = ref.current
    if (!el || visible || url) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true)
      },
      { rootMargin: '300px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, visible, url])

  useEffect(() => {
    if (!visible || url) return
    let active = true
    const make = mime === 'application/pdf' ? pdfPreview({ id, filename }) : imagePreview({ id, mime })
    void make.then((u) => {
      if (active) setUrl(u)
    })
    return () => {
      active = false
    }
  }, [visible, url, id, filename, mime])

  return url
}

/** Vorschauen gelöschter Dateien entfernen (auch solcher, die auf einem anderen Gerät gelöscht wurden) */
export async function prunePdfPreviews(ids: string[]) {
  const cache = await openCache()
  if (!cache) return
  const keep = new Set(ids)
  try {
    for (const request of await cache.keys()) {
      // /previews/<id> und die Seiten /previews/<id>/<seite>
      const id = new URL(request.url).pathname.split('/')[2]
      if (!keep.has(id)) await cache.delete(request)
    }
  } catch {
    // egal – dann beim nächsten Mal
  }
}
