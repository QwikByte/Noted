'use client'
import { useEffect, useMemo, useRef } from 'react'
import { renderMarkdown } from '@/shared/markdown/render'
import { sanitize } from '@/shared/markdown/sanitize'
import type { ResolvedNote } from '@/shared/markdown/syntax'
import { isDarkMode } from '@/shared/client/prefs'
import { Properties } from './Properties'
import { cn } from '@/shared/ui/cn'

let mermaidCounter = 0
/**
 * Gerenderte Diagramme je Thema und Quelltext: Die Vorschau ersetzt beim Tippen ihr ganzes HTML – unveränderte
 * Diagramme kommen dann aus dem Speicher, statt neu gerendert zu werden
 */
const mermaidCache = new Map<string, string>()
const MERMAID_CACHE_SIZE = 50

const mermaidSource = (block: HTMLElement) => block.querySelector('.mermaid-source')?.textContent ?? ''

async function renderMermaid(root: HTMLElement) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-block:not([data-rendered])'))
  if (blocks.length === 0) return
  // Auf dem Blatt einer Notiz ist es auch im Dark Mode hell
  const theme = isDarkMode() && !root.closest('.note-paper') ? 'dark' : 'neutral'
  const missing = blocks.filter((block) => {
    const svg = mermaidCache.get(`${theme}\u0000${mermaidSource(block)}`)
    if (svg === undefined) return true
    block.setAttribute('data-rendered', '1')
    block.innerHTML = svg
    return false
  })
  if (missing.length === 0) return
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: 'inherit' })
  for (const block of missing) {
    block.setAttribute('data-rendered', '1')
    try {
      const source = mermaidSource(block)
      const { svg } = await mermaid.render(`mermaid-${++mermaidCounter}`, source)
      block.innerHTML = svg
      mermaidCache.set(`${theme}\u0000${source}`, svg)
      // Das älteste zuerst vergessen
      const oldest = mermaidCache.keys().next().value
      if (mermaidCache.size > MERMAID_CACHE_SIZE && oldest !== undefined) mermaidCache.delete(oldest)
    } catch (err) {
      const msg = document.createElement('div')
      msg.className = 'mermaid-error'
      msg.textContent = `Mermaid-Fehler: ${err instanceof Error ? err.message.split('\n')[0] : 'unbekannt'}`
      block.appendChild(msg)
    }
  }
}

/** Was Links in gerendertem Markdown auslösen (auch in Mindmap und Canvas) */
export type PreviewLinks = {
  resolveNote: (target: string) => ResolvedNote | null
  onOpenNote: (id: string, heading?: string) => void
  /** Tresor-Notiz? Deren Überschriften kommen nicht in die Adresse */
  isVaultNote?: (id: string) => boolean
  onCreateNote: (title: string) => void
  onOpenTag: (tag: string) => void
  /** PDF im eingebauten Viewer öffnen statt in einem neuen Tab */
  onOpenPdf?: (file: string, page?: number) => void
}

export function Preview({
  content,
  resolveNote,
  onOpenNote,
  onCreateNote,
  onOpenTag,
  onToggleTask,
  onOpenPdf,
  fileUrl,
  plainNoteLinks,
  print,
  onRendered,
  className,
  lang,
}: PreviewLinks & {
  content: string
  onToggleTask?: (line: number, checked: boolean) => void
  /** Adresse eingebetteter Dateien (Standard: /api/files/…) */
  fileUrl?: (name: string) => string
  /** Links auf Notizen nur als Text (geteilte Ansicht) */
  plainNoteLinks?: boolean
  /** Für die Druckansicht (siehe RenderEnv.print) */
  print?: boolean
  /** Diagramme sind gerendert – auch ohne Diagramme und wenn Mermaid offline nicht geladen werden kann */
  onRendered?: () => void
  className?: string
  /** Sprache des Inhalts (BCP-47), z. B. aus `lang:` im Frontmatter – für Vorlesen und Silbentrennung */
  lang?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const rendered = useMemo(() => {
    const r = renderMarkdown(content, { resolveNote, fileUrl, plainNoteLinks, print })
    return { ...r, html: sanitize(r.html) }
  }, [content, resolveNote, fileUrl, plainNoteLinks, print])

  const latestOnRendered = useRef(onRendered)
  useEffect(() => {
    latestOnRendered.current = onRendered
  })
  // Nacheinander rendern: Läuft der Effekt doppelt (Strict Mode), meldet nur der noch gültige Durchlauf – und erst,
  // wenn auch der vorige fertig ist
  const queue = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    const root = ref.current
    if (!root) return
    let valid = true
    queue.current = queue.current.then(() => renderMermaid(root)).catch(() => {})
    void queue.current.then(() => {
      if (valid) latestOnRendered.current?.()
    })
    return () => {
      valid = false
    }
  }, [rendered.html])

  function onClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    if (target instanceof HTMLInputElement && target.classList.contains('task-checkbox')) {
      if (!onToggleTask) {
        e.preventDefault()
        return
      }
      onToggleTask(Number(target.dataset.line), target.checked)
      return
    }
    const a = target.closest('a')
    if (!a) return
    if (e.metaKey || e.ctrlKey || e.shiftKey) return
    if (a.dataset.pdf && onOpenPdf) {
      e.preventDefault()
      onOpenPdf(a.dataset.pdf, Number(a.dataset.page) || undefined)
    } else if (a.classList.contains('tag')) {
      e.preventDefault()
      onOpenTag(a.dataset.tag ?? '')
    } else if (a.dataset.noteId) {
      e.preventDefault()
      onOpenNote(a.dataset.noteId, a.dataset.heading)
    } else if (a.classList.contains('unresolved') && a.dataset.target) {
      e.preventDefault()
      onCreateNote(a.dataset.target)
    } else if (a.getAttribute('href')?.startsWith('#')) {
      e.preventDefault()
      const id = decodeURIComponent(a.getAttribute('href')!.slice(1))
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
      document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    }
  }

  return (
    <div className={cn('markdown-body', className)} lang={lang} onClick={onClick}>
      {rendered.properties || rendered.propertiesError ? (
        <Properties data={rendered.properties} error={rendered.propertiesError} onOpenTag={onOpenTag} />
      ) : null}
      <div ref={ref} dangerouslySetInnerHTML={{ __html: rendered.html }} />
    </div>
  )
}
