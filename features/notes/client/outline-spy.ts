'use client'
// Gliederung im Browser: zu einer Überschrift springen und den Abschnitt an der Leseposition verfolgen
import { useEffect, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import type { EditorMode } from '@/shared/client/prefs'
import { currentEntry, type OutlineEntry } from '../outline'
import type { NoteFormat } from '../types'
import type { RichTextHandle } from './editor-handle'

/** Lesekante: Aktuell ist der Abschnitt, dessen Überschrift so weit unter der Oberkante oder darüber steht */
const READING_EDGE = 96
/** Abstand einer angesprungenen Überschrift zur Oberkante – wie scroll-margin-top der Überschriften in app/globals.css */
const HEADING_MARGIN = 80
const PREVIEW_HEADINGS = '.markdown-body :is(h1, h2, h3, h4, h5, h6)'
const RICH_HEADINGS = '.rich-text :is(h1, h2, h3)'
// Eingaben, mit denen man selbst weiterliest – danach gilt wieder die Scrollposition statt des angeklickten Eintrags
const RELEASE_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown']

/** Cursor an den Anfang der Zeile (0-basiert), die Zeile oben zeigen – ohne `focus` nur den Cursor setzen */
export function revealLine(view: EditorView, line: number, focus: boolean) {
  const pos = view.state.doc.line(Math.min(line + 1, view.state.doc.lines)).from
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: HEADING_MARGIN }) })
  if (focus) view.focus()
}

function showHeading(el: HTMLElement, focus: boolean) {
  el.scrollIntoView({ block: 'start' })
  if (!focus) return
  el.tabIndex = -1
  el.focus({ preventScroll: true })
}

type Target = {
  /** Bereich unter dem Kopf der Notiz mit Editor und Vorschau */
  root: HTMLElement | null
  format: NoteFormat
  mode: EditorMode
  view: EditorView | null
  rich: RichTextHandle | null
}

/**
 * Zum Eintrag springen: im Editor zur Zeile, im Lesemodus zur Überschrift, im Modus „Geteilt“ beides. Mit `focus`
 * (Auswahl per Tastatur) wandert der Fokus mit – in den Editor bzw. auf die Überschrift
 */
export function revealEntry({ root, format, mode, view, rich }: Target, entry: OutlineEntry, focus: boolean) {
  if (format === 'richtext') {
    if (mode !== 'read' && rich) return rich.revealHeading(entry.key, focus)
    const el = root?.querySelectorAll<HTMLElement>(RICH_HEADINGS)[entry.key]
    if (el) showHeading(el, focus)
    return
  }
  if (mode !== 'read' && view) revealLine(view, entry.key, focus)
  if (mode !== 'edit') {
    const el = root?.querySelector<HTMLElement>(`${PREVIEW_HEADINGS}[data-line="${entry.key}"]`)
    if (el) showHeading(el, focus && mode === 'read')
  }
}

const atBottom = (el: Element) =>
  el.scrollHeight > el.clientHeight + 1 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2

/** Letzte Überschrift, deren Oberkante an oder über `edge` liegt (die Liste ist in Dokumentreihenfolge) */
function lastAbove(headings: NodeListOf<HTMLElement>, edge: number): number {
  let lo = -1
  let hi = headings.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (headings[mid].getBoundingClientRect().top <= edge) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Position an der Lesekante: Zeile im Editor bzw. Quellzeile oder Nummer der Überschrift darüber */
function readingPosition(root: HTMLElement, format: NoteFormat, mode: EditorMode, view: EditorView | null) {
  // Im Modus „Geteilt“ zählt die Editorseite
  if (format === 'markdown' && mode !== 'read') {
    const scroller = view?.dom.closest('.note-desk')
    if (!view || !scroller) return null
    const edge = scroller.getBoundingClientRect().top + READING_EDGE
    const block = view.lineBlockAtHeight(edge - view.documentTop)
    return { position: view.state.doc.lineAt(block.from).number - 1, atEnd: atBottom(scroller) }
  }
  const headings = root.querySelectorAll<HTMLElement>(
    format === 'richtext' ? RICH_HEADINGS : `${PREVIEW_HEADINGS}[data-line]`,
  )
  const scroller = (
    headings[0] ?? root.querySelector(format === 'richtext' ? '.rich-text' : '.markdown-body')
  )?.closest('.note-desk')
  if (!scroller) return null
  const i = lastAbove(headings, scroller.getBoundingClientRect().top + READING_EDGE)
  const position = i < 0 ? null : format === 'richtext' ? i : Number(headings[i].dataset.line)
  return { position, atEnd: atBottom(scroller) }
}

/**
 * Aktueller Eintrag der Gliederung nach der Scrollposition (nicht nach dem Cursor): ein Scroll-Listener für alle
 * Scrollbereiche unter dem Kopf. `pin` hält nach einem Klick den gewählten Eintrag fest, auch wenn der Sprung am Ende
 * des Textes anstößt – bis man selbst scrollt, tippt oder klickt
 */
export function useOutlineSpy({
  containerRef,
  format,
  mode,
  entries,
  getView,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  format: NoteFormat
  mode: EditorMode
  entries: OutlineEntry[]
  getView: () => EditorView | null
}): { current: number; pin: (index: number) => void } {
  const [current, setCurrent] = useState(-1)
  const pinned = useRef<number | null>(null)
  const latestView = useRef(getView)
  useEffect(() => {
    latestView.current = getView
  })

  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    pinned.current = null
    let frame = 0
    const measure = () => {
      frame = 0
      if (pinned.current !== null) return
      const at = readingPosition(root, format, mode, latestView.current())
      setCurrent(currentEntry(entries, at?.position ?? null, at?.atEnd ?? false))
    }
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.classList.contains('note-desk')) return
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const release = () => {
      pinned.current = null
    }
    const options = { capture: true, passive: true }
    root.addEventListener('scroll', onScroll, options)
    for (const type of RELEASE_EVENTS) root.addEventListener(type, release, options)
    // Einträge oder Ansicht haben sich geändert – erst nach dem Rendern messen
    frame = requestAnimationFrame(measure)
    return () => {
      cancelAnimationFrame(frame)
      root.removeEventListener('scroll', onScroll, options)
      for (const type of RELEASE_EVENTS) root.removeEventListener(type, release, options)
    }
  }, [containerRef, format, mode, entries])

  const pin = (index: number) => {
    pinned.current = index
    setCurrent(index)
  }
  return { current, pin }
}
