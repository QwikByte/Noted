'use client'
// Karteneditor, Bildverdeckung: Bild wählen (Anhang, Upload oder PDF-Seite), Flächen ziehen und beschriften
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileImage, Upload, X } from 'lucide-react'
import { attachmentsKey, useAttachments } from '@/features/attachments/client/queries'
import { niceFileName, uploadAttachment } from '@/features/attachments/client/upload'
import { renderPdfPage } from '@/features/pdf/client/pdfjs'
import { Button } from '@/shared/ui/button'
import { Input, Select, Switch } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { errorMessage } from '@/shared/client/api'
import { IMAGE_EXT } from '@/shared/markdown/syntax'
import { MAX_MASK_LABEL } from '../limits'
import { OcclusionEditor } from './Occlusion'
import type { Occlusion } from '../types'

const baseName = (file: string) => (file.split('/').pop() ?? file).replace(/\.[^.]+$/, '')

/**
 * Flächen einer Bildverdeckung bearbeiten. Ohne Bild erst die Auswahl; `onImage` meldet ein neu gewähltes Bild
 * (z. B. um den Titel vorzuschlagen).
 */
export function OcclusionFields({
  value,
  onChange,
  onImage,
}: {
  value: Occlusion | null
  onChange: (o: Occlusion | null) => void
  onImage: (title: string) => void
}) {
  const [selected, setSelected] = useState<number | null>(null)
  if (!value) {
    return (
      <ImagePicker
        onPick={(image) => {
          onChange({ image, masks: [], hideAll: false })
          onImage(baseName(image))
        }}
      />
    )
  }
  const masks = value.masks
  const remove = (index: number) => {
    onChange({ ...value, masks: masks.filter((_, i) => i !== index) })
    setSelected(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          Flächen <span className="text-muted tabular-nums">({masks.length})</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          <FileImage className="size-4" /> Anderes Bild
        </Button>
      </div>
      <p className="text-xs text-muted">Rechtecke über die Beschriftungen ziehen – jede Fläche wird einzeln abgefragt.</p>
      <div className="rounded-xl border border-border bg-subtle p-2">
        <OcclusionEditor occlusion={value} onChange={(next) => onChange({ ...value, masks: next })} selected={selected} onSelect={setSelected} />
      </div>
      {masks.length > 0 ? (
        <ol className="space-y-1.5" data-testid="occlusion-masks">
          {masks.map((m, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="w-6 shrink-0 text-right text-xs font-semibold text-muted tabular-nums">{i + 1}</span>
              <Input
                value={m.label}
                onChange={(e) => onChange({ ...value, masks: masks.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })}
                onFocus={() => setSelected(i)}
                placeholder="Was steht darunter? (optional)"
                aria-label={`Beschriftung von Fläche ${i + 1}`}
                maxLength={MAX_MASK_LABEL}
                className={cn('h-9', selected === i && 'border-accent')}
              />
              <Button variant="ghost" size="icon-sm" onClick={() => remove(i)} aria-label={`Fläche ${i + 1} entfernen`}>
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
      <Switch
        checked={value.hideAll}
        onChange={(hideAll) => onChange({ ...value, hideAll })}
        label="Alle Flächen verdecken"
        description="Sonst ist beim Abfragen nur die abgefragte Fläche verdeckt."
      />
    </div>
  )
}

/** Bild aus den Anhängen, neu hochgeladen oder eine PDF-Seite als Bild */
function ImagePicker({ onPick }: { onPick: (filename: string) => void }) {
  const qc = useQueryClient()
  const { data: attachments = [] } = useAttachments()
  const images = attachments.filter((a) => IMAGE_EXT.test(a.filename))
  const pdfs = attachments.filter((a) => /\.pdf$/i.test(a.filename))
  const [pdf, setPdf] = useState('')
  const [page, setPage] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function run(make: () => Promise<File>) {
    setBusy(true)
    setError(null)
    try {
      const file = await make()
      const att = await uploadAttachment(file, niceFileName(file))
      await qc.invalidateQueries({ queryKey: attachmentsKey })
      onPick(att.filename)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const fromPdf = () =>
    run(async () => {
      const n = Number(page)
      if (!Number.isInteger(n) || n < 1) throw new Error('Bitte gib eine gültige Seite an.')
      const { blob } = await renderPdfPage(pdf, n)
      return new File([blob], `${baseName(pdf)} S. ${n}.png`, { type: 'image/png' })
    })

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-border-strong p-4" data-testid="occlusion-picker">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload className="size-4" /> Bild hochladen
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void run(async () => file)
          }}
          data-testid="occlusion-upload"
        />
        {images.length > 0 ? (
          <Select
            aria-label="Bild aus den Dateien"
            value=""
            onChange={(e) => e.target.value && onPick(e.target.value)}
            // Kompakt mit ! (auch unten) – cn führt Klassen nicht zusammen, sonst gewinnen Größe und Schrift von Select/Input
            className="h-9! w-auto! min-w-0 flex-1 text-sm!"
            disabled={busy}
          >
            <option value="">Aus den Dateien …</option>
            {images.map((a) => (
              <option key={a.id} value={a.filename}>
                {a.filename}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      {pdfs.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="PDF" value={pdf} onChange={(e) => setPdf(e.target.value)} className="h-9! w-auto! min-w-0 flex-1 text-sm!" disabled={busy}>
            <option value="">PDF-Seite als Bild …</option>
            {pdfs.map((a) => (
              <option key={a.id} value={a.filename}>
                {a.filename}
              </option>
            ))}
          </Select>
          {pdf ? (
            <>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={page}
                onChange={(e) => setPage(e.target.value)}
                aria-label="Seite"
                className="h-9! w-20!"
              />
              <Button size="sm" onClick={() => void fromPdf()} loading={busy}>
                Seite übernehmen
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
