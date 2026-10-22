'use client'
import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { useFloating } from '../client/use-floating'
import type { Point } from '../floating'

const DEFAULT_POSITION: Point = { x: 1, y: 0.5 }

/**
 * Verschiebbares Fenster über der App – nicht modal: daneben lässt sich weiterarbeiten. Gezogen wird am Kopf.
 * Wechselt `focusKey` auf einen neuen Wert (Öffnen per Klick, Kürzel oder Mini-Anzeige), bekommt das Element mit
 * `data-autofocus` den Fokus; `Escape` und „Schließen“ geben ihn dann an das Element zurück, das ihn vorher hatte
 * (meist der Editor, mit unverändertem Cursor). Nach dem Neuladen bei offenem Fenster bleibt der Fokus, wo er ist.
 */
export function FloatingWindow({
  id,
  title,
  actions,
  initial = DEFAULT_POSITION,
  focusKey = 0,
  onClose,
  children,
}: {
  id: string
  title: string
  /** Weitere Knöpfe im Kopf links neben „Schließen“ – mit `data-no-drag`, damit der Klick nicht als Ziehen zählt */
  actions?: React.ReactNode
  /** Startposition (Anteil der freien Fläche), bis das Fenster verschoben wird */
  initial?: Point
  /** Fokuswunsch: jeder neue Wert ≠ 0 setzt den Fokus ins Fenster */
  focusKey?: number
  onClose: () => void
  children: React.ReactNode
}) {
  const { style, dragHandlers } = useFloating(`noted:window:${id}:pos`, initial)
  const titleId = useId()
  const sectionRef = useRef<HTMLElement>(null)
  // Hatte vor dem Öffnen den Fokus – bekommt ihn beim Schließen zurück
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const section = sectionRef.current
    if (!focusKey || !section || section.contains(document.activeElement)) return
    const before = document.activeElement
    returnFocus.current = before instanceof HTMLElement && before !== document.body ? before : null
    const target = section.querySelector<HTMLElement>('[data-autofocus]')
    target?.focus({ preventScroll: true })
    // Im Textfeld weiterschreiben, wo der Text aufhört
    if (target instanceof HTMLTextAreaElement) target.setSelectionRange(target.value.length, target.value.length)
  }, [focusKey])

  function close() {
    const back = returnFocus.current
    const inside = !!sectionRef.current?.contains(document.activeElement)
    returnFocus.current = null
    onClose()
    if (inside && back?.isConnected) back.focus({ preventScroll: true })
  }

  return (
    <div data-floating className="pointer-events-auto absolute w-72 max-w-full" style={style}>
      <section
        ref={sectionRef}
        role="dialog"
        aria-labelledby={titleId}
        data-testid={`window-${id}`}
        className="animate-pop-in overflow-hidden rounded-xl border border-border bg-elevated shadow-pop"
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
        }}
        // Knöpfe im Fenster nehmen dem Editor den Fokus nicht weg – so lässt sich nebenher weiterschreiben
        onMouseDown={(e) => {
          if ((e.target as Element).closest('button')) e.preventDefault()
        }}
      >
        <header
          className="flex h-10 cursor-grab touch-none items-center gap-0.5 border-b border-border pr-1 pl-3 select-none active:cursor-grabbing"
          {...dragHandlers}
        >
          <h2 id={titleId} className="flex-1 truncate text-sm font-semibold">
            {title}
          </h2>
          {actions}
          <Button variant="ghost" size="icon-sm" data-no-drag onClick={close} aria-label="Schließen" title="Schließen">
            <X className="size-4" />
          </Button>
        </header>
        {children}
      </section>
    </div>
  )
}
