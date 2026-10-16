'use client'
import { useRef, useSyncExternalStore } from 'react'
import { cn } from '../../ui/cn'

const WIDE = '(min-width: 1024px)'

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (fn) => {
      const mq = matchMedia(query)
      mq.addEventListener('change', fn)
      return () => mq.removeEventListener('change', fn)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}

/**
 * Hauptansicht und Seitenpanel (PDF) nebeneinander – auf schmalen Bildschirmen übereinander.
 * Der Trenner lässt sich ziehen (Doppelklick: wieder halbe-halbe). `size` = Anteil des Panels in Prozent.
 */
export function SplitPane({
  main,
  side,
  full,
  size,
  onResize,
}: {
  main: React.ReactNode
  side: React.ReactNode | null
  full: boolean
  size: number
  onResize: (size: number) => void
}) {
  const wide = useMediaQuery(WIDE)
  const root = useRef<HTMLDivElement>(null)
  const sideRef = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null)

  const sizeAt = (e: React.PointerEvent) => {
    const rect = root.current!.getBoundingClientRect()
    const pct = wide ? ((rect.right - e.clientX) / rect.width) * 100 : ((rect.bottom - e.clientY) / rect.height) * 100
    return Math.round(Math.min(80, Math.max(20, pct)))
  }

  const open = side !== null
  return (
    <div ref={root} className={cn('flex min-h-0 flex-1', wide ? 'flex-row' : 'flex-col')}>
      {/* Hauptansicht bleibt bei Vollbild-PDF eingehängt (Editor-Zustand, Scrollposition) */}
      <div className={cn('min-h-0 min-w-0 flex-1', open && full && 'hidden')}>{main}</div>
      {open && !full ? (
        <div
          role="separator"
          aria-orientation={wide ? 'vertical' : 'horizontal'}
          aria-valuenow={size}
          aria-valuemin={20}
          aria-valuemax={80}
          aria-label="Größe des PDF-Bereichs"
          tabIndex={0}
          title="Ziehen zum Ändern der Größe, Doppelklick: halbe-halbe"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = size
          }}
          onPointerMove={(e) => {
            if (drag.current === null || !sideRef.current) return
            drag.current = sizeAt(e)
            // Während des Ziehens direkt setzen – gespeichert wird beim Loslassen
            sideRef.current.style[wide ? 'width' : 'height'] = `${drag.current}%`
          }}
          onPointerUp={() => {
            if (drag.current !== null) onResize(drag.current)
            drag.current = null
          }}
          onPointerCancel={() => {
            if (drag.current !== null) onResize(drag.current)
            drag.current = null
          }}
          onDoubleClick={() => onResize(50)}
          onKeyDown={(e) => {
            const delta = { ArrowLeft: 5, ArrowUp: 5, ArrowRight: -5, ArrowDown: -5 }[e.key]
            if (delta) {
              e.preventDefault()
              onResize(Math.min(80, Math.max(20, size + delta)))
            }
          }}
          className={cn(
            'group relative z-10 flex shrink-0 touch-none items-center justify-center bg-border transition-colors hover:bg-accent focus-visible:bg-accent',
            wide ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
          )}
        >
          {/* Größere Griffläche, v. a. für Finger */}
          <span className={cn('absolute', wide ? 'inset-y-0 -inset-x-2' : 'inset-x-0 -inset-y-2.5')} />
          <span
            className={cn(
              'pointer-events-none rounded-full bg-border-strong group-hover:bg-accent',
              wide ? 'h-8 w-1' : 'h-1 w-10',
            )}
          />
        </div>
      ) : null}
      {open ? (
        <div
          ref={sideRef}
          className={cn('min-h-0 min-w-0', full ? 'flex-1' : 'shrink-0')}
          style={full ? undefined : wide ? { width: `${size}%` } : { height: `${size}%` }}
        >
          {side}
        </div>
      ) : null}
    </div>
  )
}
