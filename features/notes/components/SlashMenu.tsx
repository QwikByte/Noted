'use client'
// Menü der Befehle mit „/“ im formatierten Text. Sieht aus wie die Menüs der App, holt aber den Fokus nicht aus dem
// Editor – Tasten kommen über den Editor, Antippen lässt auf dem Handy die Tastatur offen.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { cn } from '@/shared/ui/cn'
import type { SlashEntry } from '../slash-commands'

const GAP = 6
const EDGE = 8
/** Wie .cm-tooltip-autocomplete im Markdown-Editor */
const MAX_HEIGHT = 260

/** Sichtbarer Bereich – auf dem Handy ohne die Bildschirmtastatur */
function visibleRect() {
  const vv = window.visualViewport
  if (!vv) return { top: 0, left: 0, bottom: innerHeight, right: innerWidth }
  return { top: vv.offsetTop, left: vv.offsetLeft, bottom: vv.offsetTop + vv.height, right: vv.offsetLeft + vv.width }
}

export function SlashMenu({
  editor,
  from,
  items,
  selected,
  onPick,
}: {
  editor: Editor
  /** Position des „/“ */
  from: number
  items: SlashEntry[]
  selected: number
  onPick: (index: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties | null>(null)

  // Unter dem Cursor, bei zu wenig Platz darüber – immer im sichtbaren Bereich, also über der Bildschirmtastatur
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current
      if (!el) return
      const caret = editor.view.coordsAtPos(from)
      const view = visibleRect()
      const height = Math.min(el.scrollHeight, MAX_HEIGHT)
      const below = view.bottom - caret.bottom - GAP - EDGE
      const above = caret.top - view.top - GAP - EDGE
      const up = below < height && above > below
      const room = Math.max(0, up ? above : below)
      const left = Math.max(view.left + EDGE, Math.min(caret.left, view.right - el.offsetWidth - EDGE))
      setStyle({
        left,
        top: up ? undefined : caret.bottom + GAP,
        bottom: up ? window.innerHeight - caret.top + GAP : undefined,
        maxHeight: Math.min(MAX_HEIGHT, room),
      })
    }
    place()
    const vv = window.visualViewport
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    vv?.addEventListener('resize', place)
    vv?.addEventListener('scroll', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      vv?.removeEventListener('resize', place)
      vv?.removeEventListener('scroll', place)
    }
  }, [editor, from, items.length])

  // Gewählten Eintrag in Sicht holen
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // Für Screenreader: Der Editor behält den Fokus und verweist auf das Menü und den gewählten Eintrag
  useEffect(() => {
    const dom = editor.view.dom
    dom.setAttribute('aria-controls', 'slash-menu')
    dom.setAttribute('aria-activedescendant', `slash-option-${selected}`)
    return () => {
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-activedescendant')
    }
  }, [editor, selected])

  return createPortal(
    <div
      ref={ref}
      id="slash-menu"
      role="listbox"
      aria-label="Befehle"
      // Fokus und Bildschirmtastatur bleiben im Editor
      onMouseDown={(e) => e.preventDefault()}
      style={style ?? undefined}
      className={cn(
        'fixed z-50 min-w-60 animate-menu-in overflow-y-auto overscroll-contain rounded-xl border border-border bg-elevated p-1 shadow-pop',
        !style && 'invisible',
      )}
    >
      {items.map((cmd, i) => (
        <div
          key={cmd.id}
          id={`slash-option-${i}`}
          role="option"
          aria-selected={i === selected}
          onClick={() => onPick(i)}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm',
            i === selected ? 'bg-accent-soft text-accent-text' : 'text-fg hover:bg-hover',
          )}
        >
          {cmd.label}
        </div>
      ))}
    </div>,
    document.body,
  )
}
