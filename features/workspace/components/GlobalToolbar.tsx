'use client'
// Werkzeugleiste über der ganzen App: ausklappbar, rastet oben oder unten ein, öffnet Werkzeuge als kleine Fenster.
import { useSyncExternalStore } from 'react'
import { ChevronsRight, GripVertical, Timer, Wrench, type LucideIcon } from 'lucide-react'
import { useMediaQuery } from '@/shared/client/media'
import { usePref } from '@/shared/client/prefs'
import { cn } from '@/shared/ui/cn'
import { FocusMiniTimer, FocusTimer, FocusTimerSettingsToggle } from '@/features/focus/components/FocusTimer'
import { useFocusAlerts } from '@/features/focus/client/focus-timer'
import { useFloating } from '../client/use-floating'
import { FloatingWindow } from './FloatingWindow'

type Tool = {
  id: string
  label: string
  icon: LucideIcon
  Window: React.ComponentType
  /** Knöpfe im Fensterkopf */
  Actions?: React.ComponentType
  /** Kleine Anzeige unten mittig, solange das Fenster zu ist (z. B. ein laufender Timer) */
  Mini?: React.ComponentType<{ onOpen: () => void }>
}

const TOOLS: Tool[] = [
  { id: 'focus', label: 'Fokus-Timer', icon: Timer, Window: FocusTimer, Actions: FocusTimerSettingsToggle, Mini: FocusMiniTimer },
]

// Ein Klick auf die Leiste nimmt dem Editor den Fokus nicht weg
const keepFocus = (e: React.MouseEvent) => e.preventDefault()

// Standardplatz: am Desktop oben mittig (dort ist die Kopfzeile frei), auf dem Handy unten links – oben liegen dort
// die Knöpfe der Notiz, unten mittig der Mini-Timer und rechts „Neue Notiz“
const WIDE_START = { x: 0.5, y: 0 }
const NARROW_START = { x: 0, y: 1 }

const noSubscribe = () => () => {}

/** Leiste und Fenster erst im Browser zeigen: Position und Zustand stehen nur dort fest, sonst springen sie beim Laden */
export function GlobalToolbar() {
  const inBrowser = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  )
  return inBrowser ? <Toolbar /> : null
}

function Toolbar() {
  const wide = useMediaQuery('(min-width: 1024px)')
  const [expanded, setExpanded] = usePref<'0' | '1'>('noted:toolbar:expanded', '0')
  const [openPref, setOpenPref] = usePref<string>('noted:toolbar:windows', '')
  const { style, glide, dragHandlers, onKeyDown, wasDragged } = useFloating(
    'noted:toolbar:pos',
    wide ? WIDE_START : NARROW_START,
    { snapY: true },
  )
  const open = openPref.split(',').filter((id) => TOOLS.some((t) => t.id === id))
  const setOpen = (id: string, on: boolean) =>
    setOpenPref((on ? [...open.filter((o) => o !== id), id] : open.filter((o) => o !== id)).join(','))
  useFocusAlerts()

  return (
    <div
      className="pointer-events-none fixed top-[calc(env(safe-area-inset-top)+0.5rem)] right-[calc(env(safe-area-inset-right)+0.5rem)] left-[calc(env(safe-area-inset-left)+0.5rem)] z-[60] print:hidden"
      // Über festen Leisten am unteren Rand bleiben (z. B. Bewertungsknöpfe beim Lernen, siehe useBottomBar)
      style={{ bottom: 'calc(max(env(safe-area-inset-bottom), var(--bottom-bar-height, 0px)) + 0.5rem)' }}
    >
      {TOOLS.map((t) => (t.Mini && !open.includes(t.id) ? <t.Mini key={t.id} onOpen={() => setOpen(t.id, true)} /> : null))}
      <div
        data-floating
        className={cn('pointer-events-auto absolute', glide && 'transition-[left,top,transform] duration-200 ease-out')}
        style={style}
        data-testid="global-toolbar"
      >
        {expanded === '1' ? (
          <div
            role="toolbar"
            aria-label="Werkzeuge"
            className="flex animate-pop-in items-center gap-0.5 rounded-xl border border-border bg-elevated p-1 shadow-pop"
            onMouseDown={keepFocus}
          >
            <button
              type="button"
              aria-label="Werkzeugleiste verschieben"
              title="Verschieben – rastet oben oder unten ein (auch mit den Pfeiltasten)"
              className="flex h-9 w-6 cursor-grab touch-none items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg active:cursor-grabbing"
              {...dragHandlers}
              onKeyDown={onKeyDown}
            >
              <GripVertical className="size-4" />
            </button>
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={open.includes(t.id)}
                aria-label={t.label}
                title={t.label}
                onClick={() => setOpen(t.id, !open.includes(t.id))}
                className={cn(
                  'flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg [&>svg]:size-[18px]',
                  open.includes(t.id) && 'bg-active text-fg',
                )}
              >
                <t.icon />
              </button>
            ))}
            <button
              type="button"
              aria-label="Werkzeugleiste einklappen"
              title="Einklappen"
              onClick={() => setExpanded('0')}
              className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-fg"
            >
              <ChevronsRight className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="Werkzeuge"
            aria-expanded={false}
            title="Werkzeuge – zum Verschieben ziehen"
            onMouseDown={keepFocus}
            {...dragHandlers}
            onKeyDown={onKeyDown}
            onClick={() => {
              if (!wasDragged()) setExpanded('1')
            }}
            className="flex size-11 animate-pop-in cursor-grab touch-none items-center justify-center rounded-full border border-border bg-elevated text-muted shadow-pop hover:text-fg active:cursor-grabbing"
          >
            <Wrench className="size-[18px]" />
          </button>
        )}
      </div>
      {TOOLS.filter((t) => open.includes(t.id)).map((t) => (
        <FloatingWindow
          key={t.id}
          id={t.id}
          title={t.label}
          actions={t.Actions ? <t.Actions /> : null}
          onClose={() => setOpen(t.id, false)}
        >
          <t.Window />
        </FloatingWindow>
      ))}
    </div>
  )
}
