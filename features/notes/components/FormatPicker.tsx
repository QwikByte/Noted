'use client'
import { useState } from 'react'
import { AlertTriangle, AlignLeft, Check, Hash, Info, LayoutDashboard, Network, Type } from 'lucide-react'
import { NOTE_FORMAT_IDS, NOTE_FORMAT_LABELS, isVisualFormat } from '../format'
import type { NoteFormat } from '../types'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'
import { cn } from '@/shared/ui/cn'

const ICONS: Record<NoteFormat, React.ReactNode> = {
  markdown: <Hash />,
  richtext: <Type />,
  text: <AlignLeft />,
  mindmap: <Network />,
  canvas: <LayoutDashboard />,
}

/** Auswahl des Formats einer Notiz */
export function FormatPicker({
  value,
  onChange,
  current,
}: {
  value: NoteFormat
  onChange: (format: NoteFormat) => void
  /** Bisheriges Format (beim Ändern) – wird markiert */
  current?: NoteFormat
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Format">
      {NOTE_FORMAT_IDS.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={cn(
            'relative flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition',
            value === id ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong',
          )}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium [&>svg]:size-3.5 [&>svg]:text-accent-text">
            {ICONS[id]}
            {NOTE_FORMAT_LABELS[id].label}
            {id === current ? <span className="text-xs font-normal text-faint">(bisher)</span> : null}
          </span>
          <span className="pr-4 text-xs text-muted">{NOTE_FORMAT_LABELS[id].description}</span>
          {value === id ? <Check className="absolute top-2 right-2 size-4 text-accent-text" /> : null}
        </button>
      ))}
    </div>
  )
}

const CANVAS_TO_TEXT =
  'Die Karten werden von oben nach unten hintereinander gestellt, Gruppen zu Überschriften. Anordnung, Pfeile und Farben entfallen.'

/** Umwandlungen von und zu Mindmap und Canvas */
function visualHint(from: NoteFormat, to: NoteFormat): { text: string; lossy: boolean } {
  if (from === 'mindmap') {
    if (to === 'canvas') return { text: 'Jeder Punkt wird eine Karte, die Äste werden Linien – danach frei anordnen.', lossy: true }
    if (to === 'richtext') return { text: 'Die Gliederung wird zu Überschriften und Listen, Properties (YAML) entfallen.', lossy: true }
    return { text: 'Die Gliederung bleibt als Überschriften und Liste erhalten.', lossy: false }
  }
  if (from === 'canvas') {
    if (to === 'mindmap') return { text: 'Die Karten werden zu Punkten unter der Wurzel. Anordnung, Pfeile und Farben entfallen.', lossy: true }
    return { text: CANVAS_TO_TEXT, lossy: true }
  }
  if (to === 'mindmap') {
    if (from === 'text') return { text: 'Jede Zeile wird ein Punkt der Mindmap.', lossy: false }
    return {
      text: 'Überschriften und Listen werden zu Ästen, Absätze zu eigenen Punkten. Code-Blöcke, Tabellen und Formatierungen entfallen.',
      lossy: true,
    }
  }
  if (from === 'richtext') {
    return { text: 'Der Text kommt als Markdown auf eine Karte. Schriftfarben, Schriftgrößen und Ausrichtung entfallen.', lossy: true }
  }
  return { text: 'Der Text kommt unverändert auf eine einzelne Karte.', lossy: false }
}

/** Was beim Umwandeln passiert; `lossy`: lässt sich nicht verlustfrei zurückwandeln */
function conversionHint(from: NoteFormat, to: NoteFormat): { text: string; lossy: boolean } | null {
  if (from === to) return null
  if (isVisualFormat(from) || isVisualFormat(to)) return visualHint(from, to)
  if (from === 'markdown' && to === 'richtext') {
    return {
      text: 'Properties (YAML) entfallen. Callouts, Formeln und [[Wikilinks]] bleiben als Text stehen, werden aber nicht mehr dargestellt.',
      lossy: true,
    }
  }
  if (from === 'richtext' && to === 'markdown') {
    return { text: 'Schriftfarben, Schriftgrößen, Ausrichtung und Unterstreichungen entfallen.', lossy: true }
  }
  if (from === 'richtext') return { text: 'Alle Formatierungen und Bilder entfallen, nur der Text bleibt.', lossy: true }
  if (from === 'markdown') {
    return { text: 'Der Text bleibt unverändert – Markdown-Zeichen wie ** oder # sind danach als Text zu sehen.', lossy: false }
  }
  if (to === 'markdown') {
    return { text: 'Der Text bleibt unverändert – Zeichen wie # oder * werden ab jetzt als Formatierung gelesen.', lossy: false }
  }
  return { text: 'Der Text bleibt erhalten, Absätze werden übernommen.', lossy: false }
}

/** Format einer bestehenden Notiz ändern */
export function FormatDialog({
  open,
  current,
  onClose,
  onConfirm,
}: {
  open: boolean
  current: NoteFormat
  onClose: () => void
  onConfirm: (format: NoteFormat) => Promise<void>
}) {
  const [choice, setChoice] = useState(current)
  const [busy, setBusy] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setChoice(current)
  }
  const hint = conversionHint(current, choice)

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm(choice)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Format ändern"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={choice === current} loading={busy} onClick={() => void confirm()}>
            Umwandeln
          </Button>
        </>
      }
    >
      <FormatPicker value={choice} onChange={setChoice} current={current} />
      {hint ? (
        <p
          className={cn(
            'mt-4 flex items-start gap-2 rounded-lg p-3 text-sm',
            hint.lossy ? 'bg-warning-soft text-warning' : 'bg-subtle text-muted',
          )}
          data-testid="format-hint"
        >
          {hint.lossy ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
          <span>
            {hint.text}
            {hint.lossy ? ' Das lässt sich nicht verlustfrei rückgängig machen.' : null}
          </span>
        </p>
      ) : null}
    </Modal>
  )
}
