'use client'
// Werkzeuge über der ganzen App: Ein Griff mittig am rechten Bildschirmrand klappt die Leiste auf; jedes Werkzeug
// öffnet als kleines, verschiebbares Fenster. Läuft ein Werkzeug bei geschlossenem Fenster weiter (Timer), steht es
// klein unten links neben der Navigation.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronLeft, ChevronRight, Sparkles, StickyNote, Timer, type LucideIcon } from 'lucide-react'
import { usePref } from '@/shared/client/prefs'
import { cn } from '@/shared/ui/cn'
import { FocusMiniTimer, FocusTimer, FocusTimerSettingsToggle } from '@/features/focus/components/FocusTimer'
import { useFocusAlerts } from '@/features/focus/client/alerts'
import { Scratchpad } from '@/features/scratchpad/components/Scratchpad'
import { AiChat, AiChatActions } from '@/features/ai/components/AiChat'
import { useAiReady } from '@/features/ai/client/ai'
import { AppContext, useBridgedApp } from '../client/context'
import { FloatingWindow } from './FloatingWindow'
import type { Point } from '../floating'

type Tool = {
  id: string
  label: string
  icon: LucideIcon
  Window: React.ComponentType
  /** Knöpfe im Fensterkopf */
  Actions?: React.ComponentType
  /** Kleine Anzeige unten links, solange das Fenster zu ist (z. B. ein laufender Timer) */
  Mini?: React.ComponentType<{ onOpen: () => void }>
  /** Startposition des Fensters, bis man es verschiebt – sonst lägen die Fenster übereinander */
  position?: Point
  /** Beim Öffnen den Fokus ins Fenster (auf das Element mit `data-autofocus`) */
  focusOnOpen?: boolean
  /** Tastenkürzel Alt + Taste – `code` wie KeyboardEvent.code, damit es auch mit der Wahltaste unter macOS geht */
  shortcut?: { code: string; label: string }
  /** Breiteres Fenster, das sich auf Vollbild umschalten lässt */
  large?: boolean
  /** Nur mit eingerichteter KI – und nur in der App selbst (braucht ihre Aktionen, z. B. Notiz anlegen) */
  ai?: boolean
}

const TOOLS: Tool[] = [
  { id: 'focus', label: 'Fokus-Timer', icon: Timer, Window: FocusTimer, Actions: FocusTimerSettingsToggle, Mini: FocusMiniTimer },
  {
    id: 'scratchpad',
    label: 'Schmierzettel',
    icon: StickyNote,
    Window: Scratchpad,
    position: { x: 1, y: 1 },
    focusOnOpen: true,
    shortcut: { code: 'KeyJ', label: 'Alt+J' },
  },
  {
    id: 'chat',
    label: 'KI-Chat',
    icon: Sparkles,
    Window: AiChat,
    Actions: AiChatActions,
    position: { x: 1, y: 0 },
    focusOnOpen: true,
    shortcut: { code: 'KeyK', label: 'Alt+K' },
    large: true,
    ai: true,
  },
]

// Abstand zum unteren Rand: über Leisten, die dort fest liegen (siehe useReservedSpace)
const BOTTOM = 'calc(max(env(safe-area-inset-bottom), var(--bottom-bar-height, 0px)) + 0.5rem)'
// Der Mini-Timer rechts neben der Seitenleiste (auf dem Handy ist sie zu: ganz links)
const MINI_LEFT = 'calc(max(env(safe-area-inset-left), var(--sidebar-width, 0px)) + 0.5rem)'
// Fenster lassen am rechten Rand Platz für die aufgeklappte Leiste
const WINDOWS_RIGHT = 'calc(env(safe-area-inset-right) + 3.25rem)'

// Über „Neue Notiz“ (z-30), unter der Seitenleiste auf dem Handy (z-40) und unter Menüs (z-50)
const LAYER = 'z-[35] print:hidden'

// Ein Klick auf die Leiste nimmt dem Editor den Fokus nicht weg
const keepFocus = (e: React.MouseEvent) => e.preventDefault()

const noSubscribe = () => () => {}

/** Erst im Browser zeigen: Zustand und Fensterpositionen stehen nur dort fest, sonst springen sie beim Laden */
export function GlobalToolbar() {
  const inBrowser = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  )
  return inBrowser ? <Toolbar /> : null
}

function Toolbar() {
  const [expanded, setExpanded] = usePref<'0' | '1'>('noted:toolbar:expanded', '0')
  const [openPref, setOpenPref] = usePref<string>('noted:toolbar:windows', '')
  const [maxPref, setMaxPref] = usePref<string>('noted:toolbar:maximized', '')
  const aiReady = useAiReady()
  const app = useBridgedApp()
  const tools = TOOLS.filter((t) => !t.ai || (aiReady && app))
  const open = openPref.split(',').filter((id) => tools.some((t) => t.id === id))
  const setOpen = (id: string, on: boolean) =>
    setOpenPref((on ? [...open.filter((o) => o !== id), id] : open.filter((o) => o !== id)).join(','))
  const maximized = maxPref.split(',').filter(Boolean)
  const toggleMaximized = (id: string) =>
    setMaxPref((maximized.includes(id) ? maximized.filter((m) => m !== id) : [...maximized, id]).join(','))
  useFocusAlerts()
  // Fokuswunsch je Fenster: ein Zähler, nicht gespeichert – nach dem Neuladen bleibt der Fokus, wo er ist
  const [focusWishes, setFocusWishes] = useState<Record<string, number>>({})
  const openTool = (tool: Tool) => {
    setOpen(tool.id, true)
    if (tool.focusOnOpen) setFocusWishes((w) => ({ ...w, [tool.id]: (w[tool.id] ?? 0) + 1 }))
  }

  // Tastenkürzel auf allen Seiten, auch bei eingeklappter Leiste. In der Capture-Phase, damit es auch in Canvas-Karten
  // und Mindmap-Knoten greift, die keydown nicht weiterreichen – aber nicht hinter einem modalen Dialog
  const openToolRef = useRef(openTool)
  const toolsRef = useRef(tools)
  useEffect(() => {
    openToolRef.current = openTool
    toolsRef.current = tools
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || e.isComposing) return
      const tool = toolsRef.current.find((t) => t.shortcut?.code === e.code)
      if (!tool || document.querySelector('dialog:modal')) return
      e.preventDefault()
      openToolRef.current(tool)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <>
      <div className={cn('pointer-events-none fixed flex items-center gap-2', LAYER)} style={{ left: MINI_LEFT, bottom: BOTTOM }}>
        {tools.map((t) => (t.Mini && !open.includes(t.id) ? <t.Mini key={t.id} onOpen={() => openTool(t)} /> : null))}
      </div>

      <div
        className={cn('fixed top-1/2 right-[env(safe-area-inset-right)] -translate-y-1/2', LAYER)}
        data-testid="global-toolbar"
      >
        {expanded === '1' ? (
          <div
            role="toolbar"
            aria-label="Werkzeuge"
            aria-orientation="vertical"
            className="flex animate-slide-in-right flex-col items-center gap-0.5 rounded-l-xl border border-r-0 border-border bg-elevated p-1 shadow-pop"
            onMouseDown={keepFocus}
          >
            {tools.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={open.includes(t.id)}
                aria-label={t.label}
                aria-keyshortcuts={t.shortcut?.label}
                title={t.shortcut ? `${t.label} (${t.shortcut.label})` : t.label}
                onClick={() => (open.includes(t.id) ? setOpen(t.id, false) : openTool(t))}
                className={cn(
                  'flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg [&>svg]:size-[18px]',
                  open.includes(t.id) && 'bg-active text-fg',
                )}
              >
                <t.icon />
              </button>
            ))}
            <button
              type="button"
              aria-label="Werkzeugleiste schließen"
              title="Einklappen"
              onClick={() => setExpanded('0')}
              className="mt-0.5 flex h-7 w-10 items-center justify-center rounded-lg border-t border-border pt-0.5 text-faint hover:text-fg"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="Werkzeuge"
            aria-expanded={false}
            title="Werkzeuge"
            onMouseDown={keepFocus}
            onClick={() => setExpanded('1')}
            // Schmaler Griff, aber eine breitere Trefffläche für den Finger
            className="relative flex h-16 w-6 animate-slide-in-right items-center justify-center rounded-l-lg border border-r-0 border-border bg-elevated text-faint shadow-pop before:absolute before:inset-y-0 before:-left-3 before:right-0 hover:text-fg"
          >
            <ChevronLeft className="size-4" />
          </button>
        )}
      </div>

      <div
        className={cn(
          'pointer-events-none fixed top-[calc(env(safe-area-inset-top)+0.5rem)] left-[calc(env(safe-area-inset-left)+0.5rem)]',
          LAYER,
        )}
        style={{ bottom: BOTTOM, right: WINDOWS_RIGHT }}
      >
        {tools
          .filter((t) => open.includes(t.id))
          .map((t) => (
            <FloatingWindow
              key={t.id}
              id={t.id}
              title={t.label}
              actions={t.Actions ? <t.Actions /> : null}
              initial={t.position}
              focusKey={focusWishes[t.id] ?? 0}
              wide={t.large}
              maximized={t.large && maximized.includes(t.id)}
              onToggleMaximize={t.large ? () => toggleMaximized(t.id) : undefined}
              onClose={() => setOpen(t.id, false)}
            >
              <AppContext.Provider value={app}>
                <t.Window />
              </AppContext.Provider>
            </FloatingWindow>
          ))}
      </div>
    </>
  )
}
