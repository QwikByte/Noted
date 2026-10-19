'use client'
import { api } from '@/shared/client/api'
import type { Attachment } from '../types'

const EMBED = /^(image|audio|video)\/|^application\/pdf$/

export async function uploadAttachment(file: File, name?: string): Promise<Attachment> {
  const form = new FormData()
  form.append('file', file, name ?? file.name)
  const res = await api<{ attachment: Attachment }>('/api/attachments', { method: 'POST', form })
  return res.attachment
}

/** Syntax für einen Anhang: Bilder/PDF/Audio/Video eingebettet, sonst als Link. */
export function attachmentMarkdown(att: Pick<Attachment, 'filename' | 'mime'>): string {
  return EMBED.test(att.mime) ? `![[${att.filename}]]` : `[[${att.filename}]]`
}

/** Fotos von der Handykamera heißen oft „image.jpg“ – sinnvolleren Namen vergeben. */
export function niceFileName(file: File): string {
  if (/^(image|photo|img)(\.\w+)?$/i.test(file.name) || !file.name) {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const ext = file.name.match(/\.\w+$/)?.[0] ?? (file.type === 'image/png' ? '.png' : '.jpg')
    return `Foto ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}${ext}`
  }
  return file.name
}
