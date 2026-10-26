'use client'
// Zur Fundstelle springen: Treffer aus der Volltextsuche in der geöffneten Notiz zeigen – im Editor über CodeMirror,
// im Lesemodus und im formatierten Text über die CSS Custom Highlight API, ohne den DOM zu ändern
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { findMatches, type TextMatch } from '../search-match'
import { clearSearchHits, showSearchHits } from './editor/search-hits'

/** Wo gesucht wird: der Markdown- bzw. Text-Editor oder gerendertes HTML (Lesemodus, formatierter Text) */
export type FindSurface = { kind: 'editor'; view: () => EditorView | null } | { kind: 'dom'; root: () => HTMLElement | null }

type Found = { kind: 'editor'; view: EditorView; hits: TextMatch[] } | { kind: 'dom'; ranges: Range[] }

// Text in diesen Elementen ist nicht zu sehen (Quelltext von Formeln und Diagrammen) oder kein Inhalt
const HIDDEN = '.katex-mathml, .mermaid-source, script, style, svg, button'
// Zwischen zwei Blöcken steht im DOM oft kein Leerraum – sonst klebten „Absatz“ und „Neuer“ zusammen
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, figcaption, summary, div'

const highlights = () => (typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null)

/** Fundstellen im gerenderten Text als DOM-Bereiche */
function domRanges(root: HTMLElement, terms: string[]): Range[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(HIDDEN) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''
  let block: Element | null = null
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const b = n.parentElement?.closest(BLOCK) ?? null
    if (nodes.length && b !== block) text += '\n'
    block = b
    starts.push(text.length)
    nodes.push(n)
    text += n.data
  }
  const at = (offset: number, end: boolean): [Text, number] => {
    // Letzter Knoten, der an oder vor der Stelle beginnt (beim Ende: davor)
    let lo = 0
    let hi = nodes.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] < offset || (!end && starts[mid] === offset)) lo = mid
      else hi = mid - 1
    }
    return [nodes[lo], Math.min(offset - starts[lo], nodes[lo].data.length)]
  }
  return findMatches(text, terms).map((m) => {
    const range = document.createRange()
    range.setStart(...at(m.from, false))
    range.setEnd(...at(m.to, true))
    return range
  })
}

function reveal(range: Range | undefined) {
  if (!range) return
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
}

/**
 * Fundstellen für `terms` in der Notiz markieren und zur ersten springen. `surfaceKey` wechselt mit Format und Modus:
 * Dann wird auf der neuen Fläche gesucht. Editor und Lesemodus sind nicht immer sofort aufgebaut – daher ein paar
 * Versuche. `count` 0: nichts gefunden (z. B. Treffer nur im Titel).
 */
export function useFindInNote(terms: string[] | null, surface: FindSurface, surfaceKey: string) {
  const [state, setState] = useState({ count: 0, index: 0 })
  const found = useRef<Found | null>(null)
  const latestSurface = useRef(surface)
  useEffect(() => {
    latestSurface.current = surface
  })

  const show = useCallback((index: number) => {
    const f = found.current
    if (!f) return
    if (f.kind === 'editor') showSearchHits(f.view, f.hits, index)
    else {
      const range = f.ranges[index]
      if (range) highlights()?.set('search-current', new Highlight(range))
      reveal(range)
    }
  }, [])

  useEffect(() => {
    if (!terms?.length) return
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      const s = latestSurface.current
      if (s.kind === 'editor') {
        const view = s.view()
        if (!view) return retry()
        const hits = findMatches(view.state.doc.toString(), terms)
        found.current = { kind: 'editor', view, hits }
        setState({ count: hits.length, index: 0 })
        if (hits.length) show(0)
        return
      }
      const root = s.root()
      if (!root?.textContent?.trim()) return retry()
      const ranges = domRanges(root, terms)
      found.current = { kind: 'dom', ranges }
      setState({ count: ranges.length, index: 0 })
      if (ranges.length) {
        highlights()?.set('search-hit', new Highlight(...ranges))
        show(0)
      }
    }
    // Formatierter Text wird erst nachgeladen – bis zu zwei Sekunden warten
    const retry = () => {
      if (++tries < 40) timer = setTimeout(run, 50)
    }
    run()
    return () => {
      clearTimeout(timer)
      const f = found.current
      if (f?.kind === 'editor') clearSearchHits(f.view)
      highlights()?.delete('search-hit')
      highlights()?.delete('search-current')
      found.current = null
      setState({ count: 0, index: 0 })
    }
  }, [terms, surfaceKey, show])

  const go = (step: 1 | -1) => {
    if (state.count === 0) return
    const index = (state.index + step + state.count) % state.count
    setState({ ...state, index })
    show(index)
  }

  return { ...state, next: () => go(1), prev: () => go(-1) }
}
