'use client'
import { useRef, useState } from 'react'
import { File, FileAudio, FileText, FileVideo } from 'lucide-react'
import { usePdfPreview } from '../client/preview'
import type { Attachment } from '../types'

function FileIcon({ mime }: { mime: string }) {
  if (mime.startsWith('audio/')) return <FileAudio className="size-6" />
  if (mime.startsWith('video/')) return <FileVideo className="size-6" />
  if (mime === 'application/pdf' || mime.startsWith('text/')) return <FileText className="size-6" />
  return <File className="size-6" />
}

/** Vorschau in der Karte einer Datei: Bilder selbst, von PDFs die erste Seite, sonst ein Symbol für die Art */
export function FilePreview({ file }: { file: Attachment }) {
  if (file.mime === 'application/pdf') return <PdfPreview file={file} />
  if (file.mime.startsWith('image/')) return <ImagePreview file={file} />
  return <FileIcon mime={file.mime} />
}

function ImagePreview({ file }: { file: Attachment }) {
  const [failed, setFailed] = useState(false)
  // Manche Formate zeigt nicht jeder Browser an (HEIC z. B. Safari, aber nicht Chrome) – dann bleibt es beim Symbol
  if (failed) return <FileIcon mime={file.mime} />
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/attachments/${file.id}`}
      alt={file.filename}
      loading="lazy"
      className="size-full object-cover"
      onError={() => setFailed(true)}
    />
  )
}

function PdfPreview({ file }: { file: Attachment }) {
  const ref = useRef<HTMLSpanElement>(null)
  const url = usePdfPreview(ref, file)
  return (
    <span ref={ref} className="flex size-full items-center justify-center">
      {url ? (
        // Oberer Teil der Seite: Titel und Überschrift erkennt man am ehesten
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full animate-fade-in bg-white object-cover object-top" />
      ) : (
        <FileIcon mime={file.mime} />
      )}
    </span>
  )
}
