'use client'
// Vorschau eines PDFs im Bereich „Dateien“: die erste Seite, einmal gerendert und im Browser aufbewahrt
import { useEffect, useState } from 'react'
import { fetchPdf, renderPdfData } from '@/features/pdf/client/pdfjs'
import type { Attachment } from '../types'

/** Beginnt mit „noted-data“, damit die Vorschauen beim Abmelden wie die übrigen Offline-Daten gelöscht werden */
const CACHE = 'noted-data-previews'
/** Breite in Pixeln – auch Folien im Querformat bleiben in der Karte auf hochauflösenden Bildschirmen scharf */
const WIDTH = 640
/** PDFs, die gleichzeitig geladen und gerendert werden – sonst holt ein voller Ordner alle Dateien auf einmal */
const PARALLEL = 2

/** Schlüssel im Cache – nur ein Name, unter der Adresse antwortet der Server nicht */
const cacheKey = (id: string) => `/previews/${id}`

const previews = new Map<string, Promise<string | null>>()
/** Fertige Vorschauen: erscheinen beim erneuten Öffnen eines Ordners sofort */
const ready = new Map<string, string>()

const waiting: (() => void)[] = []
let running = 0

async function inTurn<T>(task: () => Promise<T>): Promise<T> {
  if (running < PARALLEL) running++
  // Der Platz wird beim Ende einer anderen Aufgabe direkt übergeben
  else await new Promise<void>((resolve) => waiting.push(resolve))
  try {
    return await task()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else running--
  }
}

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

async function render(file: Pick<Attachment, 'id' | 'filename'>): Promise<string> {
  const cache = await openCache()
  let blob = await cache?.match(cacheKey(file.id)).then((r) => r?.blob())
  if (!blob) {
    const page = await inTurn(async () => renderPdfData(await loadPdf(file), 1, WIDTH, 'image/jpeg'))
    blob = page.blob
    // Inhalt einer Datei ändert sich nie (neue Datei = neue ID), die Vorschau bleibt also gültig
    void cache?.put(cacheKey(file.id), new Response(blob, { headers: { 'content-type': blob.type } })).catch(() => {})
  }
  const url = URL.createObjectURL(blob)
  ready.set(file.id, url)
  return url
}

function preview(file: Pick<Attachment, 'id' | 'filename'>): Promise<string | null> {
  let p = previews.get(file.id)
  if (!p) {
    p = render(file).catch(() => {
      // Offline und noch nie geöffnet: beim nächsten Mal erneut versuchen. Sonst (beschädigt, Passwort) bleibt es
      // für diese Sitzung beim Symbol
      if (!navigator.onLine) previews.delete(file.id)
      return null
    })
    previews.set(file.id, p)
  }
  return p
}

/**
 * Bildadresse der ersten Seite – sobald `ref` in die Nähe des sichtbaren Bereichs kommt; null, solange sie fehlt oder
 * sich nicht erzeugen lässt.
 */
export function usePdfPreview(ref: React.RefObject<Element | null>, file: Pick<Attachment, 'id' | 'filename'>): string | null {
  const [visible, setVisible] = useState(false)
  const [url, setUrl] = useState<string | null>(() => ready.get(file.id) ?? null)
  const { id, filename } = file

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
    void preview({ id, filename }).then((u) => {
      if (active) setUrl(u)
    })
    return () => {
      active = false
    }
  }, [visible, url, id, filename])

  return url
}

/** Vorschauen gelöschter Dateien entfernen (auch solcher, die auf einem anderen Gerät gelöscht wurden) */
export async function prunePdfPreviews(ids: string[]) {
  const cache = await openCache()
  if (!cache) return
  const keep = new Set(ids.map(cacheKey))
  try {
    for (const request of await cache.keys()) {
      if (!keep.has(new URL(request.url).pathname)) await cache.delete(request)
    }
  } catch {
    // egal – dann beim nächsten Mal
  }
}
