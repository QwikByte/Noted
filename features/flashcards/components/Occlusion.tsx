'use client'
// Bildverdeckung: das Bild mit verdeckten Flächen (Lernen, Vorschau) und das Zeichnen der Flächen im Karteneditor –
// mit Maus, Stift oder Finger (Pointer Events) oder mit der Tastatur
import { useImperativeHandle, useRef, useState } from 'react'
import { cn } from '@/shared/ui/cn'
import { defaultFileUrl } from '@/shared/markdown/syntax'
import { MAX_MASKS } from '../limits'
import { fitMask, maskId, maskName, MIN_MASK_SIZE, moveMask, newMask, resizeMask } from '../occlusion'
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

/** Schritt der Pfeiltasten als Anteil am Bild – mit Umschalt der große */
const STEP = 0.01
const BIG_STEP = 0.05
const ARROWS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
}

const percent = (n: number) => `${Math.round(n * 100)} %`

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border px-1">{children}</kbd>
}

/** Befehle des Editors für die Leiste darüber */
export type OcclusionEditorHandle = { addMask: () => void }

/**
 * Flächen über das Bild ziehen, verschieben (ziehen) und an der Ecke in der Größe ändern. Mit der Tastatur: Punkt und
 * Komma wählen die nächste bzw. vorige Fläche, die Pfeiltasten verschieben sie, Alt+Pfeiltasten ändern ihre Größe
 * (mit Umschalt jeweils in großen Schritten), Entf löscht sie und Escape hebt die Auswahl auf.
 */
export function OcclusionEditor({
  ref,
  occlusion,
  onChange,
  selected,
  onSelect,
}: {
  ref?: React.Ref<OcclusionEditorHandle>
  occlusion: Occlusion
  onChange: (masks: OcclusionMask[]) => void
  selected: number | null
  onSelect: (index: number | null) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [draft, setDraft] = useState<OcclusionMask | null>(null)
  /** Ansage für Bildschirmleser */
  const [status, setStatus] = useState('')
  const masks = occlusion.masks
  // Die Auswahl kann von einem vorher gewählten Bild übrig sein
  const current = selected !== null && selected < masks.length ? selected : null

  function addMask() {
    if (masks.length >= MAX_MASKS) return
    onChange([...masks, newMask(masks)])
    onSelect(masks.length)
    setStatus(`Fläche ${masks.length + 1} hinzugefügt und ausgewählt.`)
    // Gleich mit den Pfeiltasten weiter, ohne erst ins Bild wechseln zu müssen
    box.current?.focus()
  }

  // Ohne Abhängigkeitsliste: Der Knopf soll immer die aktuellen Flächen sehen
  useImperativeHandle(ref, () => ({ addMask }))

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
    const next = d.kind === 'move' ? moveMask(d.orig, dx, dy) : resizeMask(d.orig, dx, dy)
    onChange(masks.map((m, i) => (i === d.index ? { ...next, label: m.label } : m)))
  }

  function onPointerUp() {
    const d = drag.current
    drag.current = null
    if (d?.kind !== 'new') return
    setDraft(null)
    // Ein Tippen ohne Ziehen legt keine Fläche an
    if (draft && draft.w >= MIN_MASK_SIZE && draft.h >= MIN_MASK_SIZE) {
      onChange([...masks, { ...fitMask(draft), id: maskId(masks) }])
      onSelect(masks.length)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (current !== null && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault()
      onChange(masks.filter((_, i) => i !== current))
      onSelect(null)
      setStatus(`Fläche ${current + 1} gelöscht.`)
      return
    }
    // Strg+Enter speichert die Karte, Strg+Pfeil und Co. bleiben dem Browser
    if (e.ctrlKey || e.metaKey) return
    const arrow = ARROWS[e.key]
    if (arrow) {
      e.preventDefault()
      if (current === null) {
        setStatus(masks.length > 0 ? 'Keine Fläche ausgewählt – Punkt wählt die nächste.' : 'Noch keine Fläche im Bild.')
        return
      }
      const step = e.shiftKey ? BIG_STEP : STEP
      const m = masks[current]
      const next = e.altKey ? resizeMask(m, arrow.dx * step, arrow.dy * step) : moveMask(m, arrow.dx * step, arrow.dy * step)
      const name = `Fläche ${current + 1}`
      if (next.x === m.x && next.y === m.y && next.w === m.w && next.h === m.h) {
        setStatus(e.altKey ? `${name} lässt sich so nicht weiter ändern.` : `${name} liegt schon am Rand des Bilds.`)
        return
      }
      onChange(masks.map((x, i) => (i === current ? next : x)))
      setStatus(
        e.altKey
          ? `${name}: ${percent(next.w)} breit, ${percent(next.h)} hoch.`
          : `${name} verschoben: ${percent(next.x)} von links, ${percent(next.y)} von oben.`,
      )
      return
    }
    if ((e.key === '.' || e.key === ',') && !e.altKey && masks.length > 0) {
      e.preventDefault()
      const by = e.key === '.' ? 1 : -1
      const index = current === null ? (by > 0 ? 0 : masks.length - 1) : (current + by + masks.length) % masks.length
      onSelect(index)
      const label = masks[index].label.trim()
      setStatus(`Fläche ${index + 1} von ${masks.length} ausgewählt${label ? `: ${label}` : ''}.`)
      return
    }
    // Ohne Auswahl schließt Escape wie gewohnt den Dialog
    if (e.key === 'Escape' && current !== null) {
      e.preventDefault()
      onSelect(null)
      setStatus('Auswahl aufgehoben.')
    }
  }

  return (
    <>
      <div
        ref={box}
        tabIndex={0}
        role="application"
        aria-label="Bild – Flächen zum Verdecken ziehen. Punkt und Komma wählen eine Fläche, Pfeiltasten verschieben sie, Alt+Pfeiltasten ändern die Größe, mit Umschalt in großen Schritten. Entf löscht, Escape hebt die Auswahl auf."
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
      <p className="mt-2 px-1 text-xs text-faint max-sm:hidden">
        Tastatur im Bild: <Key>.</Key> und <Key>,</Key> wählen die nächste bzw. vorige Fläche. Die Pfeiltasten verschieben
        sie, <Key>Alt</Key> + Pfeiltasten ändern ihre Größe, mit <Key>Umschalt</Key> in großen Schritten. <Key>Entf</Key>{' '}
        löscht, <Key>Esc</Key> hebt die Auswahl auf.
      </p>
      <p className="sr-only" aria-live="polite" data-testid="occlusion-status">
        {status}
      </p>
    </>
  )
}
