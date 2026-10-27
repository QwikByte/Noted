'use client'
// Foto (z. B. einer handschriftlichen Lösung) für Claude: verkleinert und als JPEG – Handyfotos haben oft 12 MP und
// mehr, Claude liest Schrift schon bei deutlich kleineren Bildern
import { MAX_AI_IMAGE_CHARS } from '../limits'
import type { AiImage } from '../types'
import { blobToAiImage } from './ai'

/** Längere Seite in Pixeln */
const MAX_SIDE = 1600

export async function photoForAi(file: Blob): Promise<AiImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('Das Bild konnte nicht gelesen werden. Nimm ein JPEG oder PNG.')
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Das Bild konnte nicht verkleinert werden.')
  // Durchsichtige Stellen weiß statt schwarz (JPEG kennt keine Transparenz)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
  canvas.width = canvas.height = 0
  if (!blob) throw new Error('Das Bild konnte nicht verkleinert werden.')
  const image = await blobToAiImage(blob)
  if (image.data.length > MAX_AI_IMAGE_CHARS) throw new Error('Das Bild ist zu groß.')
  return image
}
