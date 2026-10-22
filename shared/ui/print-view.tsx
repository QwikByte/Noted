'use client'
// Druckansicht: eine Ebene im selben Dokument, die auf dem Bildschirm eine Vorschau auf dem hellen Blatt zeigt und im
// Druck als Einzige sichtbar ist. Keine eigene Seite und kein iframe – so geht es offline und mit noch nicht
// gespeicherten Änderungen, und Content-Security-Policy und X-Frame-Options bleiben unberührt. Bewusst kein <dialog>:
// Inhalte in der obersten Ebene lassen sich nicht zuverlässig über mehrere Seiten drucken.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { Button } from './button'

/** So lange wird höchstens auf Bilder und Schriften gewartet */
const MAX_WAIT_MS = 10_000

/**
 * `title`: Name des Dokuments – solange die Ansicht offen ist, der Titel des Fensters (Dateiname bei „Als PDF
 * speichern“). `heading`: Überschrift auf dem Blatt. `ready`: Der Inhalt ist fertig gerendert (z. B. Diagramme) –
 * danach wird noch auf Bilder und Schriften gewartet. `compact`: kleinere Schrift, zwei Spalten.
 */
export function PrintView({
  title,
  heading,
  options,
  notice,
  compact,
  ready = true,
  onClose,
  children,
}: {
  title: string
  heading?: React.ReactNode
  options?: React.ReactNode
  notice?: React.ReactNode
  compact?: boolean
  ready?: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  // Jede Änderung am Inhalt (z. B. durch eine Option) zählt hoch – dann wird erneut auf Bilder gewartet
  const [revision, setRevision] = useState(0)
  const [checked, setChecked] = useState<{ revision: number; incomplete: boolean } | null>(null)
  const canPrint = ready && checked?.revision === revision
  /** Druck angefordert (Strg/⌘+P), bevor alles bereit war */
  const pending = useRef(false)

  const latest = useRef({ onClose, canPrint })
  useEffect(() => {
    latest.current = { onClose, canPrint }
  })

  const print = useCallback(() => {
    if (latest.current.canPrint) window.print()
    else pending.current = true
  }, [])

  // Öffnen: nur die Druckansicht ist bedienbar und wird gedruckt; beim Schließen alles zurück
  useLayoutEffect(() => {
    const root = rootRef.current
    const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const others = [...document.body.children].filter((el): el is HTMLElement => el !== root && el instanceof HTMLElement && !el.inert)
    for (const el of others) el.inert = true
    document.documentElement.classList.add('print-open')
    barRef.current?.focus()
    return () => {
      for (const el of others) el.inert = false
      document.documentElement.classList.remove('print-open')
      restoreFocus?.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])

  // Tastatur: Esc schließt, Strg/⌘+P druckt. Die übrigen Kürzel der App öffneten Dialoge hinter dieser Ebene
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        latest.current.onClose()
      } else if (mod && !e.shiftKey && !e.altKey && key === 'p') {
        e.preventDefault()
        e.stopPropagation()
        print()
      } else if ((mod && (key === 'k' || key === 'o')) || (e.altKey && e.code === 'KeyN') || (mod && e.shiftKey && key === 'f')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [print])

  // Ändert sich der Inhalt des Blatts, erneut prüfen. Nur Knoten, keine Attribute – unten wird `loading` gesetzt
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    const observer = new MutationObserver(() => setRevision((r) => r + 1))
    observer.observe(sheet, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [])

  // Erst drucken, wenn alle Bilder geladen und die Schriften (z. B. für KaTeX) bereit sind – höchstens 10 s
  useEffect(() => {
    const sheet = sheetRef.current
    if (!ready || !sheet) return
    let current = true
    const images = [...sheet.querySelectorAll('img')]
    // Sonst lädt der Browser Bilder, die nie im sichtbaren Bereich waren, gar nicht erst
    for (const img of images) img.loading = 'eager'
    const loaded = Promise.all(images.map((img) => img.decode().then(() => true, () => false)))
      .then(async (results) => {
        await document.fonts.ready
        return results.every(Boolean)
      })
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), MAX_WAIT_MS))
    void Promise.race([loaded, timeout]).then((complete) => {
      if (!current) return
      setChecked({ revision, incomplete: !complete })
      if (pending.current) {
        pending.current = false
        // Erst nach dem Zeichnen: Der Knopf ist dann bereit, das Blatt vollständig
        requestAnimationFrame(() => window.print())
      }
    })
    return () => {
      current = false
    }
  }, [ready, revision])

  return createPortal(
    <div
      ref={rootRef}
      className="print-root @container fixed inset-0 z-[60] flex flex-col bg-bg"
      role="dialog"
      aria-modal="true"
      aria-labelledby={id}
      data-testid="print-view"
    >
      <div className="pt-safe border-b border-border bg-elevated print:hidden">
        <div ref={barRef} tabIndex={-1} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 outline-none">
          <h2 id={id} className="min-w-0 flex-1 basis-40 truncate font-semibold">
            Drucken <span className="font-normal text-muted">· {title}</span>
          </h2>
          {options ? <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">{options}</div> : null}
          <div className="flex gap-2">
            <Button variant="primary" size="sm" loading={!canPrint} onClick={print}>
              {canPrint ? <Printer className="size-4" /> : null} Drucken
            </Button>
            <Button size="sm" onClick={onClose}>
              <X className="size-4" /> Schließen
            </Button>
          </div>
        </div>
        {notice || (canPrint && checked?.incomplete) ? (
          <div className="space-y-0.5 px-4 pb-2.5 text-sm text-muted">
            {notice ? <p>{notice}</p> : null}
            {canPrint && checked?.incomplete ? <p className="text-warning">Nicht alle Bilder konnten geladen werden.</p> : null}
          </div>
        ) : null}
      </div>
      <div className="note-desk min-h-0 flex-1 overflow-y-auto">
        {/* inert: Links, Aufgaben und Fundstellen in der Vorschau lösen nichts aus */}
        <div
          ref={sheetRef}
          className="note-paper print-sheet"
          data-compact={compact ? '' : undefined}
          inert
          data-testid="print-sheet"
        >
          {heading ? <h1 className="print-title">{heading}</h1> : null}
          <div className="print-content">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Option in der Leiste der Druckansicht – wirkt sofort in der Vorschau */
export function PrintOption({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />
      {label}
    </label>
  )
}

let opener: (() => boolean) | null = null

/**
 * Meldet, wie sich die Druckansicht der offenen Ansicht (Notiz, Glossar, Stapel) öffnen lässt – für Strg/⌘+P.
 * `null`: Gerade gibt es nichts zu drucken.
 */
export function usePrintShortcut(open: (() => void) | null) {
  const latest = useRef(open)
  useEffect(() => {
    latest.current = open
  })
  useEffect(() => {
    const entry = () => {
      if (!latest.current) return false
      latest.current()
      return true
    }
    opener = entry
    return () => {
      if (opener === entry) opener = null
    }
  }, [])
}

/** Strg/⌘+P: Druckansicht der offenen Ansicht öffnen – `false`, wenn es keine gibt */
export function openPrintShortcut(): boolean {
  return opener?.() ?? false
}
