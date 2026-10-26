'use client'
import { useCallback } from 'react'
import { useSearchParams } from 'next/navigation'

export type View =
  | { kind: 'home' }
  /**
   * heading: Überschrift, zu der die Notiz springt (Links wie [[Notiz#Abschnitt]]) · find: Suchwörter aus der
   * Volltextsuche, deren Fundstellen markiert werden
   */
  | { kind: 'note'; id: string; heading?: string; find?: string }
  | { kind: 'folder'; id: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'search'; q: string }
  | { kind: 'trash' }
  /** Dateien in der Ordnerstruktur der Notizen – folder: Ordner-ID oder UNLINKED (Dateien ohne Notiz) */
  | { kind: 'files'; folder?: string }
  | { kind: 'cards' }
  | { kind: 'calendar' }
  | { kind: 'deck'; id: string }
  | { kind: 'study'; scope: StudyScope; mode: StudyMode }
  | { kind: 'stats' }
  /** Notiz abfragen: Überschriften als Fragen, Abschnitte als Antworten */
  | { kind: 'quiz'; id: string }
  /** Glossar und Formeln – aller Notizen oder eines Ordners samt Unterordnern */
  | { kind: 'glossary'; folder?: string }
  /** Graph der Wikilinks zwischen den Notizen */
  | { kind: 'graph' }

/** Was gelernt wird: alles, ein Stapel, die Karten einer Notiz oder die Stapel einer Klausur (Termin-ID) */
export type StudyScope = 'all' | `deck:${string}` | `note:${string}` | `exam:${string}`
/** learn: Lernmodus mit Wiederholungsplan · practice: Üben ohne Einfluss auf den Plan */
export type StudyMode = 'learn' | 'practice'

export function viewFromParams(params: URLSearchParams): View {
  const n = params.get('n')
  if (n) return { kind: 'note', id: n, heading: params.get('h') || undefined, find: params.get('find') || undefined }
  const f = params.get('f')
  if (f) return { kind: 'folder', id: f }
  const t = params.get('t')
  if (t) return { kind: 'tag', tag: t }
  const d = params.get('d')
  if (d) return { kind: 'deck', id: d }
  const s = params.get('s')
  if (s === 'all' || /^(deck|note|exam):[\w-]+$/.test(s ?? '')) {
    return { kind: 'study', scope: s as StudyScope, mode: params.get('m') === 'practice' ? 'practice' : 'learn' }
  }
  const quiz = params.get('quiz')
  if (quiz) return { kind: 'quiz', id: quiz }
  const q = params.get('q')
  if (q !== null) return { kind: 'search', q }
  const v = params.get('v')
  if (v === 'trash') return { kind: 'trash' }
  if (v === 'files') return { kind: 'files', folder: params.get('in') || undefined }
  if (v === 'cards') return { kind: 'cards' }
  if (v === 'stats') return { kind: 'stats' }
  if (v === 'calendar') return { kind: 'calendar' }
  if (v === 'glossary') return { kind: 'glossary', folder: params.get('in') || undefined }
  if (v === 'graph') return { kind: 'graph' }
  return { kind: 'home' }
}

/** Adresse einer Ansicht – auch zum Öffnen in einem neuen Tab */
export function viewToUrl(view: View): string {
  switch (view.kind) {
    case 'note':
      return (
        `/?n=${encodeURIComponent(view.id)}` +
        (view.heading ? `&h=${encodeURIComponent(view.heading)}` : '') +
        (view.find ? `&find=${encodeURIComponent(view.find)}` : '')
      )
    case 'folder':
      return `/?f=${encodeURIComponent(view.id)}`
    case 'tag':
      return `/?t=${encodeURIComponent(view.tag)}`
    case 'search':
      return `/?q=${encodeURIComponent(view.q)}`
    case 'trash':
      return '/?v=trash'
    case 'files':
      return `/?v=files${view.folder ? `&in=${encodeURIComponent(view.folder)}` : ''}`
    case 'cards':
      return '/?v=cards'
    case 'stats':
      return '/?v=stats'
    case 'calendar':
      return '/?v=calendar'
    case 'glossary':
      return `/?v=glossary${view.folder ? `&in=${encodeURIComponent(view.folder)}` : ''}`
    case 'graph':
      return '/?v=graph'
    case 'deck':
      return `/?d=${encodeURIComponent(view.id)}`
    case 'study':
      return `/?s=${encodeURIComponent(view.scope)}${view.mode === 'practice' ? '&m=practice' : ''}`
    case 'quiz':
      return `/?quiz=${encodeURIComponent(view.id)}`
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
