'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from './cn'

type Tone = 'success' | 'error' | 'info'
type Toast = { id: number; tone: Tone; message: string; duration: number; action?: { label: string; onClick: () => void } }

type ToastApi = {
  show: (message: string, opts?: { tone?: Tone; action?: Toast['action']; duration?: number }) => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

let counter = 0

/** `sticky`: dauerhafter Hinweis über den Meldungen (z. B. „Neue Version verfügbar“) */
export function ToastProvider({ children, sticky }: { children: React.ReactNode; sticky?: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const show = useCallback<ToastApi['show']>((message, opts = {}) => {
    const id = ++counter
    // Mit „Rückgängig“ länger stehen lassen – sonst ist die Meldung weg, bevor man sie (per Tastatur) erreicht
    const duration = opts.duration ?? (opts.action ? 8000 : opts.tone === 'error' ? 6000 : 3500)
    setToasts((t) => [...t.slice(-3), { id, message, tone: opts.tone ?? 'info', action: opts.action, duration }])
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show(m, { tone: 'success' }),
      error: (m) => show(m, { tone: 'error' }),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        // Oben unter der Kopfzeile: unten lägen sie über Bewertungsknöpfen, Tastatur und Neu-Knopf
        className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.5rem)] z-[100] flex flex-col items-center gap-2 px-3 sm:left-auto sm:right-4 sm:w-[24rem] sm:items-stretch sm:px-0"
        aria-live="polite"
      >
        {sticky}
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/** Eine Meldung. Solange Maus oder Fokus darauf liegen, läuft ihre Zeit nicht ab. */
function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false)
  const remaining = useRef(t.duration)
  const latest = useRef(onDismiss)
  useEffect(() => {
    latest.current = onDismiss
  })

  useEffect(() => {
    if (paused) return
    const started = Date.now()
    const timer = setTimeout(() => latest.current(), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(1000, remaining.current - (Date.now() - started))
    }
  }, [paused])

  return (
    <div
      className="pointer-events-auto flex w-full max-w-md animate-drop-in items-center gap-3 rounded-lg border border-border bg-elevated px-4 py-3 text-sm shadow-pop"
      role={t.tone === 'error' ? 'alert' : 'status'}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false)
      }}
    >
      {t.tone === 'success' ? (
        <CheckCircle2 className="size-4.5 shrink-0 text-success" />
      ) : t.tone === 'error' ? (
        <AlertCircle className="size-4.5 shrink-0 text-danger" />
      ) : (
        <Info className="size-4.5 shrink-0 text-accent" />
      )}
      <span className="min-w-0 flex-1 break-words">{t.message}</span>
      {t.action ? (
        <button
          type="button"
          className="shrink-0 font-medium text-accent-text hover:underline"
          onClick={() => {
            t.action!.onClick()
            onDismiss()
          }}
        >
          {t.action.label}
        </button>
      ) : null}
      <button type="button" onClick={onDismiss} className="shrink-0 text-faint hover:text-fg" aria-label="Schließen">
        <X className="size-4" />
      </button>
    </div>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast außerhalb von ToastProvider')
  return ctx
}

export function ErrorText({ children, className }: { children: React.ReactNode; className?: string }) {
  if (!children) return null
  return (
    <div className={cn('flex items-start gap-2 rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger', className)} role="alert">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}
