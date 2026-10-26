'use client'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { cn } from '@/shared/ui/cn'
import { releaseCanvas, renderThumbnail } from '../client/pdfjs'
import { pageLabel } from '../navigation'

/** Breite einer Miniatur in CSS-Pixeln */
const WIDTH = 120

type Observe = (el: Element, onChange: (visible: boolean) => void) => () => void

/**
 * Reiter „Seiten“: Miniaturen aus dem schon geladenen Dokument. Gezeichnet werden nur sichtbare (und knapp davor bzw.
 * dahinter), unsichtbare werden wieder freigegeben – auch ein Skript mit 300 Seiten bleibt so leicht.
 */
export default function PdfThumbnails({
  doc,
  labels,
  current,
  onSelect,
}: {
  doc: PDFDocumentProxy
  labels: string[] | null
  current: number
  onSelect: (page: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  // Platzhalter im Format der ersten Seite, bis eine Seite ihr eigenes kennt
  const [ratio, setRatio] = useState(Math.SQRT2)
  useEffect(() => {
    let cancelled = false
    doc
      .getPage(1)
      .then((p) => {
        const v = p.getViewport({ scale: 1 })
        if (!cancelled) setRatio(v.height / v.width)
      })
      .catch(() => {
        /* PDF schon geschlossen – es bleibt beim Hochformat */
      })
    return () => {
      cancelled = true
    }
  }, [doc])

  // Ein Beobachter für alle Miniaturen
  const observer = useRef<IntersectionObserver | null>(null)
  const watched = useRef(new Map<Element, (visible: boolean) => void>())
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) watched.current.get(e.target)?.(e.isIntersecting)
      },
      { root: listRef.current, rootMargin: '400px 0px' },
    )
    observer.current = io
    for (const el of watched.current.keys()) io.observe(el)
    return () => {
      io.disconnect()
      observer.current = null
    }
  }, [])
  const observe = useCallback<Observe>((el, onChange) => {
    watched.current.set(el, onChange)
    observer.current?.observe(el)
    return () => {
      watched.current.delete(el)
      observer.current?.unobserve(el)
    }
  }, [])

  // Die aktuelle Seite bleibt im Blick, auch beim Blättern im PDF
  useEffect(() => {
    listRef.current?.querySelector(`[data-page="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="pdf-thumbnails">
      <ul className="flex flex-col items-center gap-3">
        {Array.from({ length: doc.numPages }, (_, i) => (
          <li key={i}>
            <Thumbnail
              doc={doc}
              page={i + 1}
              label={pageLabel(i + 1, labels)}
              ratio={ratio}
              active={current === i + 1}
              observe={observe}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

const Thumbnail = memo(function Thumbnail({
  doc,
  page,
  label,
  ratio,
  active,
  observe,
  onSelect,
}: {
  doc: PDFDocumentProxy
  page: number
  label: string
  ratio: number
  active: boolean
  observe: Observe
  onSelect: (page: number) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [ownRatio, setOwnRatio] = useState<number | null>(null)

  useEffect(() => (ref.current ? observe(ref.current, setVisible) : undefined), [observe])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!visible || !canvas) return
    const ac = new AbortController()
    renderThumbnail(doc, page, canvas, WIDTH, ac.signal).then(
      (r) => {
        if (r && !ac.signal.aborted) setOwnRatio(r)
      },
      () => {
        /* PDF geschlossen oder gewechselt – die Miniatur bleibt leer */
      },
    )
    return () => {
      ac.abort()
      releaseCanvas(canvas)
    }
  }, [visible, doc, page])

  return (
    <button
      ref={ref}
      type="button"
      data-page={page}
      onClick={() => onSelect(page)}
      aria-label={`Seite ${label}`}
      aria-current={active ? 'page' : undefined}
      className="flex flex-col items-center gap-1 rounded-lg p-1.5 hover:bg-hover"
    >
      <canvas
        ref={canvasRef}
        style={{ width: WIDTH, height: Math.round(WIDTH * (ownRatio ?? ratio)) }}
        className={cn('rounded-sm bg-white shadow-sm', active ? 'ring-2 ring-accent' : 'ring-1 ring-border')}
      />
      <span className={cn('text-xs tabular-nums', active ? 'font-semibold text-accent-text' : 'text-muted')}>{label}</span>
    </button>
  )
})
