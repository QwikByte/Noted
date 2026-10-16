'use client'
// Werkzeugleiste über der ganzen App: ausklappbar, verschiebbar, öffnet Werkzeuge als kleine, verschiebbare Fenster.
import { ChevronsRight, GripVertical, Timer, Wrench, type LucideIcon } from 'lucide-react'
import { usePref } from '@/shared/client/prefs'
import { cn } from '@/shared/ui/cn'
import { FocusTimer, FocusTimerBadge } from '@/features/focus/components/FocusTimer'
import { useFocusAlerts } from '@/features/focus/client/focus-timer'
import { useFloating } from '../client/use-floating'
import { FloatingWindow } from './FloatingWindow'

type Tool = {
  id: string
  label: string
  icon: LucideIcon
  Window: React.ComponentType
  /** Kurzer Zustand an der Leiste, z. B. die Restzeit – auch eingeklappt sichtbar */
  Badge?: React.ComponentType
}

const TOOLS: Tool[] = [{ id: 'focus', label: 'Fokus-Timer', icon: Timer, Window: FocusTimer, Badge: FocusTimerBadge }]

// Ein Klick auf die Leiste nimmt dem Editor den Fokus nicht weg
const keepFocus = (e: React.MouseEvent) => e.preventDefault()

export function GlobalToolbar() {
  const [expanded, setExpanded] = usePref<'0' | '1'>('noted:toolbar:expanded', '0')
  const [openPref, setOpenPref] = usePref<string>('noted:toolbar:windows', '')
  const { style, dragHandlers, onKeyDown, wasDragged } = useFloating('noted:toolbar:pos', { x: 1, y: 0.7 })
  const open = openPref.split(',').filter((id) => TOOLS.some((t) => t.id === id))
  const toggle = (id: string) =>
    setOpenPref((open.includes(id) ? open.filter((o) => o !== id) : [...open, id]).join(','))
  useFocusAlerts()

  return (
    <div className="pointer-events-none fixed top-[calc(env(safe-area-inset-top)+0.5rem)] right-[calc(env(safe-area-inset-right)+0.5rem)] bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] left-[calc(env(safe-area-inset-left)+0.5rem)] z-[60] print:hidden">
      <div data-floating className="pointer-events-auto absolute" style={style} data-testid="global-toolbar">
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
              title="Verschieben (auch mit den Pfeiltasten)"
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
                onClick={() => toggle(t.id)}
                className={cn(
                  'flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg px-2 text-muted transition-colors hover:bg-hover hover:text-fg [&>svg]:size-[18px]',
                  open.includes(t.id) && 'bg-active text-fg',
                )}
              >
                <t.icon />
                {t.Badge ? <t.Badge /> : null}
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
            className="flex h-11 min-w-11 animate-pop-in cursor-grab touch-none items-center justify-center gap-2 rounded-full border border-border bg-elevated px-3 text-muted shadow-pop hover:text-fg active:cursor-grabbing"
          >
            <Wrench className="size-[18px]" />
            {TOOLS.map((t) => (t.Badge ? <t.Badge key={t.id} /> : null))}
          </button>
        )}
      </div>
      {TOOLS.filter((t) => open.includes(t.id)).map((t) => (
        <FloatingWindow key={t.id} id={t.id} title={t.label} onClose={() => toggle(t.id)}>
          <t.Window />
        </FloatingWindow>
      ))}
    </div>
  )
}
