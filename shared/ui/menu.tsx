'use client'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { cn } from './cn'

const MenuContext = createContext<{ close: () => void }>({ close: () => {} })

/** Einfaches Dropdown-Menü. */
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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open ? (
        <MenuContext.Provider value={{ close: () => setOpen(false) }}>
          <div
            role="menu"
            // Sonst wandert der Fokus auf den Eintrag und nach dem Schließen auf <body>: Was direkt danach getippt
            // wird, geht ins Leere, bis der Aufrufer den Fokus zurückholt
            onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
            className={cn(
              'absolute z-50 min-w-52 animate-pop-in rounded-xl border border-border bg-elevated p-1 shadow-pop',
              side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
              align === 'right' ? 'right-0' : 'left-0',
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
      <span className="flex-1">{children}</span>
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
