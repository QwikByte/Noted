'use client'
// Bildverdeckung: das Bild mit verdeckten Flächen (Lernen, Vorschau) und das Zeichnen der Flächen im Karteneditor –
// mit Maus, Stift oder Finger (Pointer Events)
import { useRef, useState } from 'react'
import { cn } from '@/shared/ui/cn'
import { defaultFileUrl } from '@/shared/markdown/syntax'
import { MAX_MASKS } from '../limits'
import { fitMask, maskName, MIN_MASK_SIZE } from '../occlusion'
import type { Occlusion, OcclusionMask } from '../types'

const place = (m: OcclusionMask) => ({
  left: `${m.x * 100}%`,
  top: `${m.y * 100}%`,
  width: `${m.w * 100}%`,
  height: `${m.h * 100}%`,
})

/**
 * Bild mit verdeckten Flächen: Die abgefragte Fläche (`side`) ist hervorgehoben verdeckt und wird beim Aufdecken
 * sichtbar; die übrigen sind je nach Karte ebenfalls verdeckt oder frei.
 */
export function OcclusionImage({
  occlusion,
  side,
  revealed,
  alt,
}: {
  occlusion: Occlusion
  side: number
  revealed: boolean
  /** Beschreibung des Bilds, z. B. der Titel der Karte – ohne: „Bild der Karteikarte“ */
  alt?: string
}) {
  return (
    <div className="relative mx-auto w-fit max-w-full" data-testid="occlusion-image">
      {/* eslint-disable-next-line @next/next/no-img-element -- Anhänge kommen von der eigenen API, nicht aus next/image */}
      <img
        src={defaultFileUrl(occlusion.image)}
        alt={alt || 'Bild der Karteikarte'}
        draggable={false}
        className="block max-h-[60vh] max-w-full select-none"
      />
      {occlusion.masks.map((m, i) =>
        i === side ? (
          <div
            key={i}
            className={cn(
              'absolute flex items-center justify-center rounded-sm',
              revealed ? 'border-2 border-accent' : 'bg-accent font-bold text-on-accent shadow-md',
            )}
            style={place(m)}
            data-testid={revealed ? 'occlusion-revealed' : 'occlusion-asked'}
          >
            {revealed ? null : '?'}
          </div>
        ) : occlusion.hideAll ? (
          <div key={i} className="absolute rounded-sm border border-border bg-border-strong" style={place(m)} />
        ) : null,
      )}
    </div>
  )
}

/** Kleines Vorschaubild mit allen Flächen (Kartenliste) */
export function OcclusionThumb({ occlusion }: { occlusion: Occlusion }) {
  return (
    <div className="relative mt-2 w-fit">
      {/* eslint-disable-next-line @next/next/no-img-element -- Anhänge kommen von der eigenen API, nicht aus next/image */}
      <img src={defaultFileUrl(occlusion.image)} alt="" loading="lazy" className="block max-h-24 w-auto max-w-full rounded-sm" />
      {occlusion.masks.map((m, i) => (
        <div key={i} className="absolute rounded-[2px] bg-accent/70" style={place(m)} />
      ))}
    </div>
  )
}

type Drag =
  | { kind: 'new'; x: number; y: number }
  | { kind: 'move' | 'resize'; index: number; x: number; y: number; orig: OcclusionMask }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** Flächen über das Bild ziehen, verschieben (ziehen) und an der Ecke in der Größe ändern; Entf löscht die gewählte */
export function OcclusionEditor({
  occlusion,
  onChange,
  selected,
  onSelect,
}: {
  occlusion: Occlusion
  onChange: (masks: OcclusionMask[]) => void
  selected: number | null
  onSelect: (index: number | null) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [draft, setDraft] = useState<OcclusionMask | null>(null)
  const masks = occlusion.masks

  function point(e: React.PointerEvent) {
    const r = box.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    const p = point(e)
    const el = e.target as HTMLElement
    const handle = el.closest<HTMLElement>('[data-handle]')
    const mask = el.closest<HTMLElement>('[data-mask]')
    if (handle || mask) {
      const index = Number((handle ?? mask)!.dataset.handle ?? (handle ?? mask)!.dataset.mask)
      onSelect(index)
      drag.current = { kind: handle ? 'resize' : 'move', index, ...p, orig: masks[index] }
    } else {
      if (masks.length >= MAX_MASKS) return
      onSelect(null)
      drag.current = { kind: 'new', ...p }
      setDraft({ ...p, w: 0, h: 0, label: '' })
    }
    box.current!.setPointerCapture(e.pointerId)
    // Ohne Scrollen – sonst verrutscht das Bild unter dem Zeiger, während man zieht
    box.current!.focus({ preventScroll: true })
    e.preventDefault()
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const p = point(e)
    if (d.kind === 'new') {
      setDraft({ x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y), label: '' })
      return
    }
    const dx = p.x - d.x
    const dy = p.y - d.y
    const next =
      d.kind === 'move'
        ? fitMask({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy })
        : fitMask({
            ...d.orig,
            w: Math.min(1 - d.orig.x, Math.max(MIN_MASK_SIZE, d.orig.w + dx)),
            h: Math.min(1 - d.orig.y, Math.max(MIN_MASK_SIZE, d.orig.h + dy)),
          })
    onChange(masks.map((m, i) => (i === d.index ? { ...next, label: m.label } : m)))
  }

  function onPointerUp() {
    const d = drag.current
    drag.current = null
    if (d?.kind !== 'new') return
    setDraft(null)
    // Ein Tippen ohne Ziehen legt keine Fläche an
    if (draft && draft.w >= MIN_MASK_SIZE && draft.h >= MIN_MASK_SIZE) {
      onChange([...masks, fitMask(draft)])
      onSelect(masks.length)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (selected === null || (e.key !== 'Delete' && e.key !== 'Backspace')) return
    e.preventDefault()
    onChange(masks.filter((_, i) => i !== selected))
    onSelect(null)
  }

  return (
    <div
      ref={box}
      tabIndex={0}
      role="application"
      aria-label="Bild – Flächen zum Verdecken ziehen"
      className="relative mx-auto w-fit max-w-full cursor-crosshair touch-none rounded-sm outline-none select-none focus-visible:ring-3 focus-visible:ring-accent/30"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      data-testid="occlusion-editor"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Anhänge kommen von der eigenen API, nicht aus next/image */}
      <img src={defaultFileUrl(occlusion.image)} alt="" draggable={false} className="pointer-events-none block max-h-[50vh] max-w-full" />
      {masks.map((m, i) => (
        <div
          key={i}
          data-mask={i}
          title={maskName(occlusion, i)}
          className={cn(
            'absolute cursor-move rounded-sm border-2 border-accent bg-accent/35',
            selected === i && 'bg-accent/55 ring-2 ring-accent ring-offset-1 ring-offset-elevated',
          )}
          style={place(m)}
        >
          <span className="absolute top-0 left-0 rounded-br-sm bg-accent px-1 text-[11px] leading-4 font-semibold text-on-accent">
            {i + 1}
          </span>
          {selected === i ? (
            <span
              data-handle={i}
              className="absolute -right-1.5 -bottom-1.5 size-3.5 cursor-se-resize rounded-sm border-2 border-elevated bg-accent"
            />
          ) : null}
        </div>
      ))}
      {draft ? <div className="absolute rounded-sm border-2 border-dashed border-accent bg-accent/20" style={place(draft)} /> : null}
    </div>
  )
}
