'use client'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { cn } from './cn'
import { useToast } from './toast'
import { copyText } from '@/shared/client/clipboard'

const MenuContext = createContext<{ close: () => void }>({ close: () => {} })

/** Abstand zwischen Auslöser und Menü bzw. Menü und Fensterrand */
const GAP = 6
const EDGE = 8

type Placement = { up: boolean; style: React.CSSProperties }

/** Pfeiltasten, Pos1 und Ende bewegen den Fokus durch die Einträge eines Menüs */
function moveFocus(menu: HTMLElement, key: string): boolean {
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled), a[href]')]
  if (items.length === 0) return false
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next =
    key === 'ArrowDown' ? (at + 1) % items.length
    : key === 'ArrowUp' ? (at - 1 + items.length) % items.length
    : key === 'Home' ? 0
    : key === 'End' ? items.length - 1
    : -1
  if (next < 0) return false
  items[next].focus()
  return true
}

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
  trigger: (props: {
    onClick: (e?: React.MouseEvent) => void
    'aria-expanded': boolean
    'aria-haspopup': 'menu'
  }) => React.ReactNode
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
  /** Mit der Tastatur geöffnet (Enter/Leertaste): dann gleich auf den ersten Eintrag */
  const [byKeyboard, setByKeyboard] = useState(false)

  const close = useCallback(() => {
    // Fokus zurück auf den Auslöser, statt ihn mit dem Menü zu verlieren
    if (popup.current?.contains(document.activeElement)) {
      ref.current?.querySelector<HTMLElement>('button, [href]')?.focus()
    }
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

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

  // Mit der Tastatur geöffnet: auf den ersten Eintrag – erst wenn das Menü platziert und damit sichtbar ist
  const placed = !!placement
  useEffect(() => {
    if (open && placed && byKeyboard && popup.current && !popup.current.contains(document.activeElement)) {
      moveFocus(popup.current, 'Home')
    }
  }, [open, placed, byKeyboard])

  const up = placement?.up ?? side === 'top'
  return (
    <div ref={ref} className="relative">
      {trigger({
        onClick: (e) => {
          // detail 0: Klick per Tastatur statt mit der Maus
          setByKeyboard(e?.detail === 0)
          setOpen((o) => !o)
        },
        'aria-expanded': open,
        'aria-haspopup': 'menu',
      })}
      {open ? (
        <MenuContext.Provider value={{ close }}>
          <div
            ref={popup}
            role="menu"
            // Sonst wandert der Fokus auf den Eintrag und nach dem Schließen auf <body>: Was direkt danach getippt
            // wird, geht ins Leere, bis der Aufrufer den Fokus zurückholt
            onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
            onKeyDown={(e) => {
              if (moveFocus(e.currentTarget, e.key)) e.preventDefault()
              else if (e.key === 'Tab') setOpen(false)
            }}
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
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors outline-none disabled:opacity-50',
        danger ? 'text-danger hover:bg-danger-soft focus-visible:bg-danger-soft' : 'text-fg hover:bg-hover focus-visible:bg-hover',
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

/* ------------------------------------------------------------------ */
/* Kontextmenü (Rechtsklick)                                            */
/* ------------------------------------------------------------------ */

type Opened = { x: number; y: number; content: React.ReactNode; keyboard: boolean; restore: HTMLElement | null }
type OpenAt = (point: { x: number; y: number; keyboard: boolean }, content: React.ReactNode) => void

const ContextMenuContext = createContext<OpenAt | null>(null)

/**
 * Hier bleibt das Menü des Browsers: in Eingabefeldern (Rechtschreibung, Einfügen, Passwort-Manager) und in Dialogen –
 * die liegen in der obersten Ebene über dem Kontextmenü und machen alles andere unbedienbar.
 */
function keepNative(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, dialog')
}

/**
 * Mit der Tastatur geöffnet (Kontextmenütaste, Umschalt+F10): Chromium meldet die Taste -1, andere Browser keinen
 * Zeiger oder die Position 0,0
 */
const byKeyboard = (e: MouseEvent) =>
  e.button === -1 || (e as PointerEvent).pointerType === '' || (e.clientX === 0 && e.clientY === 0)

/** Langes Drücken auf dem Handy: in Texten bleibt das Menü des Systems (Markieren, Einfügen) */
const isTouch = (e: MouseEvent) => (e as PointerEvent).pointerType === 'touch'

/** Umschalt + Rechtsklick: das Menü des Browsers (Umschalt+F10 ist dagegen die Tastatur für das eigene) */
const wantsNative = (e: MouseEvent) => e.shiftKey && !byKeyboard(e)

/** Position des Menüs: am Mauszeiger – mit der Tastatur am Element */
function pointFor(e: MouseEvent): { x: number; y: number; keyboard: boolean } {
  if (!byKeyboard(e)) return { x: e.clientX, y: e.clientY, keyboard: false }
  const rect = (e.target instanceof Element ? e.target : document.body).getBoundingClientRect()
  return { x: rect.left + 8, y: rect.top + Math.min(rect.height, 32), keyboard: true }
}

/**
 * Eigene Kontextmenüs für die ganze App. `fallback` liefert die Einträge für alles, wofür kein Bereich ein eigenes
 * Menü hat (z. B. Zurück, Neu laden). Umschalt+Rechtsklick öffnet immer das Menü des Browsers.
 */
export function ContextMenuProvider({
  children,
  fallback,
}: {
  children: React.ReactNode
  fallback?: (target: Element) => React.ReactNode | null
}) {
  const [menu, setMenu] = useState<Opened | null>(null)
  const [style, setStyle] = useState<{ left: number; top: number; up: boolean } | null>(null)
  const popup = useRef<HTMLDivElement>(null)
  const latestFallback = useRef(fallback)
  useEffect(() => {
    latestFallback.current = fallback
  })

  const openAt = useCallback<OpenAt>((point, content) => {
    const active = document.activeElement
    setStyle(null)
    setMenu({ ...point, content, restore: active instanceof HTMLElement ? active : null })
  }, [])

  const close = useCallback(() => {
    // Mit der Tastatur geöffnet: Fokus zurück, wo er vorher war
    if (menu?.restore && popup.current?.contains(document.activeElement)) menu.restore.focus({ preventScroll: true })
    setMenu(null)
  }, [menu])

  // Alles, was kein Bereich selbst übernimmt, bekommt das allgemeine Menü
  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      if (e.defaultPrevented || wantsNative(e) || keepNative(e.target) || isTouch(e)) return
      if (!(e.target instanceof Element) || popup.current?.contains(e.target)) return
      const content = latestFallback.current?.(e.target)
      if (!content) return
      e.preventDefault()
      openAt(pointFor(e), content)
    }
    document.addEventListener('contextmenu', onContext)
    return () => document.removeEventListener('contextmenu', onContext)
  }, [openAt])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => {
      if (!popup.current?.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    const dismiss = () => setMenu(null)
    // Scrollt man selbst (Mausrad, Finger), passt das Menü nicht mehr zur Stelle – im Menü (lange Listen) nicht.
    // Bewusst nicht auf „scroll“: Das feuert auch, wenn die Seite beim Laden oder Umbrechen selbst scrollt
    const onScroll = (e: Event) => {
      if (!popup.current?.contains(e.target as Node)) dismiss()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    window.addEventListener('wheel', onScroll, { capture: true, passive: true })
    window.addEventListener('touchmove', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('wheel', onScroll, true)
      window.removeEventListener('touchmove', onScroll, true)
    }
  }, [menu, close])

  // Am Mauszeiger öffnen, aber nie über den Fensterrand hinaus
  useLayoutEffect(() => {
    const el = popup.current
    if (!menu || !el) return
    const { offsetWidth: w, offsetHeight: h } = el
    const up = menu.y + h > window.innerHeight - EDGE && menu.y - h > EDGE
    setStyle({
      left: Math.max(EDGE, Math.min(menu.x, window.innerWidth - w - EDGE)),
      top: up ? menu.y - h : Math.max(EDGE, Math.min(menu.y, window.innerHeight - h - EDGE)),
      up,
    })
  }, [menu])

  // Mit der Tastatur geöffnet: auf den ersten Eintrag – erst wenn das Menü platziert und damit sichtbar ist
  useEffect(() => {
    if (menu?.keyboard && style && popup.current && !popup.current.contains(document.activeElement)) {
      moveFocus(popup.current, 'Home')
    }
  }, [menu, style])

  const ctx = useMemo(() => ({ close }), [close])
  return (
    <ContextMenuContext.Provider value={openAt}>
      {children}
      {menu ? (
        <MenuContext.Provider value={ctx}>
          <div
            ref={popup}
            role="menu"
            aria-label="Kontextmenü"
            // Fokus und Markierung bleiben, wo sie sind (z. B. im Editor) – die Befehle wirken auf die Markierung
            onMouseDown={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (moveFocus(e.currentTarget, e.key)) e.preventDefault()
              else if (e.key === 'Tab') close()
            }}
            style={style ? { left: style.left, top: style.top } : { left: menu.x, top: menu.y }}
            className={cn(
              'fixed z-[90] max-h-[calc(100dvh-1rem)] min-w-56 animate-menu-in overflow-y-auto overscroll-contain rounded-xl border border-border bg-elevated p-1 shadow-pop',
              !style && 'invisible',
              style?.up ? 'origin-bottom-left' : 'origin-top-left',
            )}
          >
            {menu.content}
          </div>
        </MenuContext.Provider>
      ) : null}
    </ContextMenuContext.Provider>
  )
}

/** „Kopieren“ für markierten Text, über den Einträgen eines Bereichs */
function CopySelectionItem({ text }: { text: string }) {
  const toast = useToast()
  return (
    <>
      <MenuItem
        icon={<Copy />}
        onSelect={async () => {
          if (await copyText(text)) toast.success('Kopiert.')
          else toast.error('Kopieren nicht möglich.')
        }}
        hint="Strg+C"
      >
        Kopieren
      </MenuItem>
      <MenuSeparator />
    </>
  )
}

/**
 * Eigenes Kontextmenü für einen Bereich: im onContextMenu-Handler aufrufen, z. B.
 * `onContextMenu={(e) => openContextMenu(e, <MenuItem …/>)}`. Mit `null` gilt das Menü des umgebenden Bereichs.
 * `text`: Der Bereich ist Text zum Markieren – auf dem Handy bleibt dort beim langen Drücken das Menü des Systems.
 * `copy`: Ist Text markiert, steht „Kopieren“ über den Einträgen (für Bereiche, die das nicht selbst anbieten).
 */
export function useContextMenu() {
  const open = useContext(ContextMenuContext)
  return useCallback(
    (e: React.MouseEvent, content: React.ReactNode, opts?: { text?: boolean; copy?: boolean }) => {
      const native = e.nativeEvent
      if (!open || !content || wantsNative(native) || keepNative(e.target) || (opts?.text && isTouch(native))) return
      e.preventDefault()
      e.stopPropagation()
      const selected = opts?.copy ? (document.getSelection()?.toString().trim() ?? '') : ''
      open(
        pointFor(native),
        selected ? (
          <>
            <CopySelectionItem text={selected} />
            {content}
          </>
        ) : (
          content
        ),
      )
    },
    [open],
  )
}
