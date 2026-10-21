'use client'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from './cn'

const MenuContext = createContext<{ close: () => void }>({ close: () => {} })

/** Abstand zwischen Auslöser und Menü bzw. Menü und Fensterrand */
const GAP = 6
const EDGE = 8

type Placement = { up: boolean; style: React.CSSProperties }

/**
 * Einfaches Dropdown-Menü. Es liegt fest im Fenster (position: fixed) statt unter dem Auslöser im Fluss: In
 * waagerecht scrollenden Werkzeugleisten und in der Seitenleiste würde es sonst abgeschnitten. Reicht der Platz auf
 * der gewünschten Seite nicht, geht es zur anderen auf.
 */
export function Menu({
  trigger,
  children,
  align = 'right',
  side = 'bottom',
  keepFocus,
  className,
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => React.ReactNode
  children: React.ReactNode
  align?: 'left' | 'right'
  side?: 'top' | 'bottom'
  /** Ein Klick auf einen Eintrag lässt den Fokus, wo er ist – z. B. im Editor, dessen Werkzeugleiste das Menü öffnet */
  keepFocus?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      // Fokus zurück auf den Auslöser, statt ihn mit dem Menü zu verlieren
      if (!keepFocus && popup.current?.contains(document.activeElement)) {
        ref.current?.querySelector<HTMLElement>('button, [href]')?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, keepFocus])

  // Vor dem ersten Zeichnen platzieren, beim Scrollen und bei Größenänderungen mitführen
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      // Der Auslöser selbst (erstes Kind), nicht der Rahmen drumherum – der kann breiter sein
      const anchor = (ref.current?.firstElementChild ?? ref.current)?.getBoundingClientRect()
      const el = popup.current
      if (!anchor || !el) return
      const height = el.scrollHeight
      const width = el.offsetWidth
      const below = window.innerHeight - anchor.bottom - GAP - EDGE
      const above = anchor.top - GAP - EDGE
      const up = side === 'top' ? above >= height || above > below : below < height && above > below
      const room = up ? above : below
      const left = align === 'right' ? anchor.right - width : anchor.left
      setPlacement({
        up,
        style: {
          top: up ? undefined : anchor.bottom + GAP,
          bottom: up ? window.innerHeight - anchor.top + GAP : undefined,
          left: Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE)),
          // Für Menüs so breit wie ihr Auslöser: className="w-(--anchor-width)"
          ['--anchor-width' as string]: `${anchor.width}px`,
          ...(height > room ? { maxHeight: room, overflowY: 'auto' } : {}),
        },
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, side, align])

  const up = placement?.up ?? side === 'top'
  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open ? (
        <MenuContext.Provider value={{ close: () => setOpen(false) }}>
          <div
            ref={popup}
            role="menu"
            // Sonst wandert der Fokus auf den Eintrag und nach dem Schließen auf <body>: Was direkt danach getippt
            // wird, geht ins Leere, bis der Aufrufer den Fokus zurückholt
            onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
            style={placement?.style}
            className={cn(
              'fixed z-50 min-w-52 animate-menu-in overscroll-contain rounded-xl border border-border bg-elevated p-1 shadow-pop',
              // Unsichtbar, bis es platziert ist; danach aus der Ecke am Auslöser aufgehen
              !placement && 'invisible',
              up ? (align === 'right' ? 'origin-bottom-right' : 'origin-bottom-left') : align === 'right' ? 'origin-top-right' : 'origin-top-left',
              className,
            )}
          >
            {children}
          </div>
        </MenuContext.Provider>
      ) : null}
    </div>
  )
}

export function MenuItem({
  onSelect,
  icon,
  children,
  danger,
  disabled,
  hint,
}: {
  onSelect: () => void
  icon?: React.ReactNode
  children: React.ReactNode
  danger?: boolean
  disabled?: boolean
  hint?: string
}) {
  const { close } = useContext(MenuContext)
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        close()
        onSelect()
      }}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-50',
        danger ? 'text-danger hover:bg-danger-soft' : 'text-fg hover:bg-hover',
      )}
    >
      {icon ? <span className="flex size-4 shrink-0 items-center justify-center text-muted [&>svg]:size-4">{icon}</span> : null}
      <span className="min-w-0 flex-1">{children}</span>
      {hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-border" role="separator" />
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-faint">{children}</div>
}
