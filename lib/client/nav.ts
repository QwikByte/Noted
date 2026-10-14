'use client'
import { useCallback } from 'react'
import { useSearchParams } from 'next/navigation'

export type View =
  | { kind: 'home' }
  | { kind: 'note'; id: string; heading?: string }
  | { kind: 'folder'; id: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'search'; q: string }
  | { kind: 'trash' }
  | { kind: 'files' }
  | { kind: 'cards' }
  | { kind: 'deck'; id: string }
  | { kind: 'study'; scope: StudyScope; mode: StudyMode }

/** Was gelernt wird: alle Stapel, ein Stapel oder die Karten aus einer Notiz */
export type StudyScope = 'all' | `deck:${string}` | `note:${string}`
/** learn: Lernmodus mit Wiederholungsplan · practice: Üben ohne Einfluss auf den Plan */
export type StudyMode = 'learn' | 'practice'

export function viewFromParams(params: URLSearchParams): View {
  const n = params.get('n')
  if (n) return { kind: 'note', id: n }
  const f = params.get('f')
  if (f) return { kind: 'folder', id: f }
  const t = params.get('t')
  if (t) return { kind: 'tag', tag: t }
  const d = params.get('d')
  if (d) return { kind: 'deck', id: d }
  const s = params.get('s')
  if (s === 'all' || /^(deck|note):[\w-]+$/.test(s ?? '')) {
    return { kind: 'study', scope: s as StudyScope, mode: params.get('m') === 'practice' ? 'practice' : 'learn' }
  }
  const q = params.get('q')
  if (q !== null) return { kind: 'search', q }
  const v = params.get('v')
  if (v === 'trash') return { kind: 'trash' }
  if (v === 'files') return { kind: 'files' }
  if (v === 'cards') return { kind: 'cards' }
  return { kind: 'home' }
}

export function viewToUrl(view: View): string {
  switch (view.kind) {
    case 'note':
      return `/?n=${encodeURIComponent(view.id)}`
    case 'folder':
      return `/?f=${encodeURIComponent(view.id)}`
    case 'tag':
      return `/?t=${encodeURIComponent(view.tag)}`
    case 'search':
      return `/?q=${encodeURIComponent(view.q)}`
    case 'trash':
      return '/?v=trash'
    case 'files':
      return '/?v=files'
    case 'cards':
      return '/?v=cards'
    case 'deck':
      return `/?d=${encodeURIComponent(view.id)}`
    case 'study':
      return `/?s=${encodeURIComponent(view.scope)}${view.mode === 'practice' ? '&m=practice' : ''}`
    default:
      return '/'
  }
}

/** Navigation innerhalb der App ohne Server-Anfrage (funktioniert auch offline). */
export function useNav() {
  const params = useSearchParams()
  const view = viewFromParams(new URLSearchParams(params.toString()))
  const go = useCallback((next: View, opts: { replace?: boolean } = {}) => {
    const url = viewToUrl(next)
    if (opts.replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
  }, [])
  return { view, go }
}
