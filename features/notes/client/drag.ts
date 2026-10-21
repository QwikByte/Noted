'use client'
// Notizen und Ordner per Drag & Drop verschieben – mit Pointer-Events statt HTML5-Drag-&-Drop, damit es mit Maus
// und Touch gleich funktioniert. Mit der Maus beginnt das Ziehen nach ein paar Pixeln, mit dem Finger nach langem
// Drücken (vorher scrollt die Liste wie gewohnt). Ablageziele tragen data-drop-folder (Ordner-ID oder ROOT).
import { useSyncExternalStore } from 'react'

export type DragItem = { kind: 'note'; id: string; title: string } | { kind: 'folder'; id: string; name: string }

/** Ablageziel „oberste Ebene“ */
export const ROOT = 'root'

type DragState = { item: DragItem; x: number; y: number; touch: boolean; target: string | null }

/** Prüft und verschiebt – registriert von der DragLayer, die Notizen und Ordner kennt */
type DropHandler = {
  canDrop: (item: DragItem, target: string) => boolean
  drop: (item: DragItem, target: string) => void
}

const LONG_PRESS_MS = 400
/** So weit darf sich die Maus bewegen, bevor aus einem Klick ein Ziehen wird */
const MOUSE_THRESHOLD = 5
/** Bewegt sich der Finger vor dem langen Drücken weiter, wird gescrollt */
const TOUCH_SLOP = 8
/** Abstand zum Rand eines scrollbaren Bereichs, ab dem er beim Ziehen mitscrollt */
const SCROLL_EDGE = 48

let state: DragState | null = null
let handler: DropHandler | null = null
/** Bricht das laufende (oder auf langes Drücken wartende) Ziehen ab */
let cancelSession: (() => void) | null = null
const listeners = new Set<() => void>()

function setState(next: DragState | null) {
  state = next
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function registerDropHandler(h: DropHandler) {
  handler = h
  return () => {
    if (handler === h) handler = null
  }
}

/** Aktueller Zustand (für die Vorschau am Zeiger) */
export function useDragState(): DragState | null {
  return useSyncExternalStore(subscribe, () => state, () => null)
}

/** Ziel, über dem gerade abgelegt würde – nur gültige Ziele */
export function useDropTarget(): string | null {
  return useSyncExternalStore(subscribe, () => state?.target ?? null, () => null)
}

/** ID der Notiz bzw. des Ordners, der gerade gezogen wird */
export function useDraggedId(): string | null {
  return useSyncExternalStore(subscribe, () => state?.item.id ?? null, () => null)
}

function scrollParent(el: Element | null): HTMLElement | null {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (!(e instanceof HTMLElement) || e.scrollHeight <= e.clientHeight) continue
    const { overflowY } = getComputedStyle(e)
    if (overflowY === 'auto' || overflowY === 'scroll') return e
  }
  return null
}

let scroll: { el: HTMLElement; speed: number } | null = null
let frame = 0

function update(x: number, y: number) {
  if (!state) return
  const el = document.elementFromPoint(x, y)
  const key = el?.closest<HTMLElement>('[data-drop-folder]')?.dataset.dropFolder ?? null
  const target = key && handler?.canDrop(state.item, key) ? key : null
  setState({ ...state, x, y, target })

  const box = scrollParent(el)
  const rect = box?.getBoundingClientRect()
  const speed = !rect
    ? 0
    : y < rect.top + SCROLL_EDGE
      ? -Math.min(1, (rect.top + SCROLL_EDGE - y) / SCROLL_EDGE) * 14
      : y > rect.bottom - SCROLL_EDGE
        ? Math.min(1, (y - rect.bottom + SCROLL_EDGE) / SCROLL_EDGE) * 14
        : 0
  scroll = box && speed ? { el: box, speed } : null
  if (scroll && !frame) frame = requestAnimationFrame(autoScroll)
}

function autoScroll() {
  frame = 0
  if (!scroll || !state) return
  const before = scroll.el.scrollTop
  scroll.el.scrollTop += scroll.speed
  // Am Ende angekommen: nicht weiter im Leerlauf rechnen
  if (scroll.el.scrollTop !== before) update(state.x, state.y)
}

/** Den Klick, den der Browser nach dem Loslassen noch auslöst, verschlucken – er würde die Notiz öffnen */
function swallowClick() {
  const stop = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }
  window.addEventListener('click', stop, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 100)
}

/** Im pointerdown eines ziehbaren Elements aufrufen */
export function startDrag(e: React.PointerEvent<HTMLElement>, item: DragItem) {
  if (!handler || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
  // Falls das Loslassen des letzten Ziehens nie ankam (z. B. außerhalb des Fensters)
  cancelSession?.()
  const touch = e.pointerType !== 'mouse'
  const { pointerId, clientX: startX, clientY: startY } = e
  const listening = new AbortController()
  let started = false

  function begin(x: number, y: number) {
    started = true
    window.getSelection()?.removeAllRanges()
    document.documentElement.classList.add('dragging')
    setState({ item, x, y, touch, target: null })
    update(x, y)
  }

  function end(drop: boolean) {
    clearTimeout(timer)
    listening.abort()
    cancelSession = null
    if (!started) return
    const last = state
    scroll = null
    document.documentElement.classList.remove('dragging')
    setState(null)
    swallowClick()
    if (drop && last?.target) handler?.drop(last.item, last.target)
  }

  const on = <K extends keyof WindowEventMap>(type: K, fn: (ev: WindowEventMap[K]) => void, passive?: boolean) =>
    window.addEventListener(type, fn, { signal: listening.signal, passive })
  on('pointermove', (ev) => {
    if (ev.pointerId !== pointerId) return
    if (started) return update(ev.clientX, ev.clientY)
    const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY)
    if (touch && dist > TOUCH_SLOP) end(false)
    else if (!touch && dist > MOUSE_THRESHOLD) begin(ev.clientX, ev.clientY)
  })
  on('pointerup', (ev) => {
    if (ev.pointerId === pointerId) end(true)
  })
  on('pointercancel', () => end(false))
  // Während des Ziehens nicht scrollen – der Browser würde sonst übernehmen und das Ziehen abbrechen
  on(
    'touchmove',
    (ev) => {
      if (started && ev.cancelable) ev.preventDefault()
    },
    false,
  )
  // Langes Drücken öffnet sonst ein Kontextmenü – das des Systems und das eigene der App. Daher schon in der
  // Capture-Phase abfangen, bevor React es an die Bereiche verteilt
  window.addEventListener(
    'contextmenu',
    (ev) => {
      if (!started) return
      ev.preventDefault()
      ev.stopPropagation()
    },
    { signal: listening.signal, capture: true },
  )
  on('keydown', (ev) => {
    if (ev.key === 'Escape') end(false)
  })
  on('blur', () => end(false))
  cancelSession = () => end(false)
  const timer = touch ? setTimeout(() => begin(startX, startY), LONG_PRESS_MS) : undefined
}
