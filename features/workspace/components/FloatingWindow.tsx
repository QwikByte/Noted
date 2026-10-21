'use client'
import { useId } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { useFloating } from '../client/use-floating'

/** Verschiebbares Fenster über der App – nicht modal: daneben lässt sich weiterarbeiten. Gezogen wird am Kopf. */
export function FloatingWindow({
  id,
  title,
  actions,
  onClose,
  children,
}: {
  id: string
  title: string
  /** Weitere Knöpfe im Kopf links neben „Schließen“ – mit `data-no-drag`, damit der Klick nicht als Ziehen zählt */
  actions?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}) {
  const { style, dragHandlers } = useFloating(`noted:window:${id}:pos`, { x: 1, y: 0.5 })
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
          className="flex h-10 cursor-grab touch-none items-center gap-0.5 border-b border-border pr-1 pl-3 select-none active:cursor-grabbing"
          {...dragHandlers}
        >
          <h2 id={titleId} className="flex-1 truncate text-sm font-semibold">
            {title}
          </h2>
          {actions}
          <Button variant="ghost" size="icon-sm" data-no-drag onClick={onClose} aria-label="Schließen" title="Schließen">
            <X className="size-4" />
          </Button>
        </header>
        {children}
      </section>
    </div>
  )
}
