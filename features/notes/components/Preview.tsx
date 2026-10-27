'use client'
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import DOMPurify from 'dompurify'
import { QueryClientContext } from '@tanstack/react-query'
import { renderMarkdown } from '@/shared/markdown/render'
import { sanitize } from '@/shared/markdown/sanitize'
import type { ResolvedNote } from '@/shared/markdown/syntax'
import { isDarkMode } from '@/shared/client/prefs'
import { Properties } from './Properties'
import { cn } from '@/shared/ui/cn'
import { EmbedContext, MAX_EMBED_DEPTH, MAX_EMBEDS } from '../client/embeds'
import { attachmentsQuery } from '@/features/attachments/client/queries'
import { renderPdfPageImages } from '@/features/attachments/client/preview'

let mermaidCounter = 0
/**
 * Gerenderte Diagramme je Thema und Quelltext: Die Vorschau ersetzt beim Tippen ihr ganzes HTML – unveränderte
 * Diagramme kommen dann aus dem Speicher, statt neu gerendert zu werden
 */
const mermaidCache = new Map<string, string>()
const MERMAID_CACHE_SIZE = 50

const mermaidSource = (block: HTMLElement) => block.querySelector('.mermaid-source')?.textContent ?? ''

/**
 * Das von Mermaid gelieferte SVG stammt aus Nutzertext – vor dem Einfügen bereinigen. Beschriftungen liegen als HTML
 * in <foreignObject>, das DOMPurify nur als Integrationspunkt zulässt.
 */
const sanitizeDiagram = (svg: string) =>
  DOMPurify.sanitize(svg, { ADD_TAGS: ['foreignObject'], HTML_INTEGRATION_POINTS: { foreignobject: true } })

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
      const svg = sanitizeDiagram((await mermaid.render(`mermaid-${++mermaidCounter}`, source)).svg)
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

/** Stelle, an der eine eingebettete Notiz gezeichnet wird – ersetzt ihre Link-Karte im gerenderten HTML */
type EmbedHost = {
  key: string
  el: HTMLElement
  anchor: HTMLAnchorElement
  noteId: string
  heading: string | null
  title: string
  href: string
}

let embedGeneration = 0

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
  embeds,
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
  /** Eingebettete Notizen zeigen (Lesemodus, Druck) – sofern ein EmbedContext sagt, wie */
  embeds?: boolean
  /**
   * Diagramme und eingebettete Notizen sind gerendert – auch ohne sie und wenn Mermaid oder eine Notiz offline nicht
   * geladen werden kann
   */
  onRendered?: () => void
  className?: string
  /** Sprache des Inhalts (BCP-47), z. B. aus `lang:` im Frontmatter – für Vorlesen und Silbentrennung */
  lang?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { chain, Embed } = useContext(EmbedContext)
  // Innerhalb einer Einbettung: Überschriften ohne Anker und Quellzeile, sonst hielte sie die Gliederung für eigene
  const embedded = chain.length > 1
  const rendered = useMemo(() => {
    const r = renderMarkdown(content, { resolveNote, fileUrl, plainNoteLinks, print, embedded })
    return { ...r, html: sanitize(r.html) }
  }, [content, resolveNote, fileUrl, plainNoteLinks, print, embedded])

  // Eingebettete Notizen: Ihre Link-Karten (data-embed) werden durch den Inhalt ersetzt – höchstens MAX_EMBEDS, nicht
  // tiefer als MAX_EMBED_DEPTH und keine Notiz, die schon weiter oben in der Kette steht
  const canEmbed = !!embeds && !!Embed && !plainNoteLinks && chain.length > 0 && chain.length <= MAX_EMBED_DEPTH
  const chainKey = chain.join('/')
  const [hosts, setHosts] = useState<EmbedHost[]>([])
  const embedsSettled = useRef<{ waiting: Set<string>; resolve: () => void; ready: Promise<void> } | null>(null)
  useLayoutEffect(() => {
    const root = ref.current
    const found: EmbedHost[] = []
    if (root && canEmbed) {
      const generation = ++embedGeneration
      const above = chainKey.split('/')
      for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a.embed-note[data-embed]')) {
        const noteId = anchor.dataset.noteId
        if (found.length >= MAX_EMBEDS) break
        if (!noteId || above.includes(noteId)) continue
        const el = document.createElement('div')
        el.className = 'note-embed'
        anchor.replaceWith(el)
        found.push({
          key: `${generation}:${found.length}`,
          el,
          anchor,
          noteId,
          heading: anchor.dataset.heading ?? null,
          title: anchor.dataset.target ?? '',
          href: anchor.getAttribute('href') ?? `/?n=${noteId}`,
        })
      }
    }
    let resolve = () => {}
    const ready = new Promise<void>((r) => (resolve = r))
    embedsSettled.current = { waiting: new Set(found.map((h) => h.key)), resolve, ready }
    if (found.length === 0) resolve()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Die Stellen gibt es erst im DOM (dangerouslySetInnerHTML)
    setHosts((prev) => (prev.length === 0 && found.length === 0 ? prev : found))
    // Wieder die Link-Karten – z. B. wenn der Effekt im Strict Mode doppelt läuft. Ein neues HTML hat sie ohnehin.
    return () => {
      for (const h of found) h.el.replaceWith(h.anchor)
    }
  }, [rendered.html, canEmbed, chainKey])

  const embedSettled = useCallback((key: string) => {
    const settled = embedsSettled.current
    if (settled?.waiting.delete(key) && settled.waiting.size === 0) settled.resolve()
  }, [])

  const latestOnRendered = useRef(onRendered)
  useEffect(() => {
    latestOnRendered.current = onRendered
  })
  // Nacheinander rendern: Läuft der Effekt doppelt (Strict Mode), meldet nur der noch gültige Durchlauf – und erst,
  // wenn auch der vorige fertig ist
  const queue = useRef<Promise<void>>(Promise.resolve())
  // Seitenbilder eingebetteter PDFs brauchen die Dateiliste – in geteilten Notizen (ohne Anmeldung) bleibt die Karte
  const queryClient = useContext(QueryClientContext)
  const pdfPages = !plainNoteLinks && queryClient ? queryClient : null
  useEffect(() => {
    const root = ref.current
    if (!root) return
    let valid = true
    // Die Einbettungen dieses Inhalts sind schon erfasst (Layout-Effekt oben)
    const embedsReady = embedsSettled.current?.ready ?? Promise.resolve()
    const pages = pdfPages ? renderPdfPageImages(root, () => pdfPages.ensureQueryData(attachmentsQuery)).catch(() => {}) : null
    queue.current = queue.current
      .then(() => renderMermaid(root))
      .then(() => pages ?? undefined)
      .catch(() => {})
    void Promise.all([queue.current, embedsReady]).then(() => {
      if (valid) latestOnRendered.current?.()
    })
    return () => {
      valid = false
    }
  }, [rendered.html, pdfPages])

  function onClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    // Klicks in eingebetteten Notizen behandeln diese selbst – eine Aufgabe dort ist keine dieser Notiz
    const host = target.closest('.note-embed')
    if (host && ref.current?.contains(host)) return
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
      {Embed
        ? hosts.map((h) =>
            createPortal(
              <Embed
                noteId={h.noteId}
                heading={h.heading}
                title={h.title}
                href={h.href}
                onSettled={() => embedSettled(h.key)}
              />,
              h.el,
              h.key,
            ),
          )
        : null}
    </div>
  )
}
