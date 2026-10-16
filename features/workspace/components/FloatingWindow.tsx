'use client'
import { useId } from 'react'
import { GripVertical, X } from 'lucide-react'
import { useFloating } from '../client/use-floating'

/** Verschiebbares Fenster über der App – nicht modal: daneben lässt sich weiterarbeiten */
export function FloatingWindow({
  id,
  title,
  onClose,
  children,
}: {
  id: string
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const { style, dragHandlers, onKeyDown } = useFloating(`noted:window:${id}:pos`, { x: 1, y: 0.15 })
  const titleId = useId()
  return (
    <div data-floating className="pointer-events-auto absolute w-72 max-w-full" style={style}>
      <section
        role="dialog"
        aria-labelledby={titleId}
        data-testid={`window-${id}`}
        className="animate-pop-in overflow-hidden rounded-xl border border-border bg-elevated shadow-pop"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        // Knöpfe im Fenster nehmen dem Editor den Fokus nicht weg – so lässt sich nebenher weiterschreiben
        onMouseDown={(e) => {
          if ((e.target as Element).closest('button')) e.preventDefault()
        }}
      >
        <header
          className="flex h-10 cursor-grab touch-none items-center gap-1 border-b border-border px-1 select-none active:cursor-grabbing"
          {...dragHandlers}
        >
          <button
            type="button"
            onKeyDown={onKeyDown}
            aria-label="Fenster verschieben"
            title="Verschieben (auch mit den Pfeiltasten)"
            className="flex size-8 cursor-grab items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg"
          >
            <GripVertical className="size-4" />
          </button>
          <h2 id={titleId} className="flex-1 truncate text-sm font-semibold">
            {title}
          </h2>
          <button
            type="button"
            data-no-drag
            onClick={onClose}
            aria-label="Schließen"
            title="Schließen"
            className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
