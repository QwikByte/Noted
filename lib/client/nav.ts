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

export function viewFromParams(params: URLSearchParams): View {
  const n = params.get('n')
  if (n) return { kind: 'note', id: n }
  const f = params.get('f')
  if (f) return { kind: 'folder', id: f }
  const t = params.get('t')
  if (t) return { kind: 'tag', tag: t }
  const q = params.get('q')
  if (q !== null) return { kind: 'search', q }
  const v = params.get('v')
  if (v === 'trash') return { kind: 'trash' }
  if (v === 'files') return { kind: 'files' }
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
