'use client'
// Eingebettete Notizen (![[Notiz]], ![[Notiz#Abschnitt]]) im Lesemodus und im Druck – und der Inhalt einer Notiz, wie
// ihn auch die Notiz-Karten im Canvas zeigen
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { mindmapToMarkdown } from '@/features/mindmap/mindmap'
import { useNote } from '../client/queries'
import { EmbedContext, type EmbedProps } from '../client/embeds'
import { noteSection } from '../sections'
import type { Note } from '../types'
import { Preview, type PreviewLinks } from './Preview'
import { PlainTextView, RichTextView } from './ReadView'

/** So lange wartet der Druck höchstens auf eine eingebettete Notiz – danach bleibt sie Link-Karte */
const MAX_WAIT_MS = 8000

const EmbedLinks = createContext<PreviewLinks | null>(null)

/**
 * Inhalt einer Notiz je nach Format. Tresor-Notizen nur in der Notiz selbst (entschlüsselt), hier ein Hinweis.
 * `section` (Markdown und Mindmap): null = ohne Frontmatter, sonst nur der Abschnitt unter dieser Überschrift – fehlt
 * es, wird die Notiz gezeigt, wie sie ist. `onRendered`: fertig gezeichnet (siehe Preview).
 */
export function NoteContent({
  note,
  section,
  links,
  embeds,
  className,
  onRendered,
}: {
  note: Note
  section?: string | null
  links: PreviewLinks
  embeds?: boolean
  className?: string
  onRendered?: () => void
}) {
  const { print } = useContext(EmbedContext)
  const isMarkdown = !note.vault && (note.format === 'markdown' || note.format === 'mindmap')
  const source = isMarkdown && note.format === 'mindmap' ? mindmapToMarkdown(note.content) : note.content
  const markdown = !isMarkdown ? null : section === undefined ? source : noteSection(source, section)
  const drawnByPreview = markdown !== null
  // Ohne Vorschau ist der Inhalt gleich fertig
  useEffect(() => {
    if (!drawnByPreview) onRendered?.()
  }, [drawnByPreview, onRendered])

  if (note.vault) return <p className="p-3 text-sm text-muted">Im Tresor – zum Lesen öffnen</p>
  if (note.format === 'richtext') return <RichTextView html={note.content} onOpenPdf={links.onOpenPdf ?? (() => {})} />
  if (note.format === 'text') return <PlainTextView text={note.content} />
  if (note.format === 'canvas') return <p className="p-3 text-sm text-muted">{note.excerpt || 'Canvas'}</p>
  if (markdown === null) {
    return <p className="p-3 text-sm text-muted">Den Abschnitt „{section}“ gibt es in dieser Notiz nicht (mehr).</p>
  }
  return <Preview content={markdown} {...links} embeds={embeds} print={print} onRendered={onRendered} className={className} />
}

/**
 * Eingebettete Notiz im gerenderten Markdown: Herkunft als Link, darunter der Abschnitt bzw. die Notiz. Aufgaben darin
 * lassen sich nicht abhaken (die Vorschau bekommt kein onToggleTask). Solange sie lädt oder wenn sie nicht geladen
 * werden kann (z. B. offline), bleibt es bei der Link-Karte.
 */
function NoteEmbed({ noteId, heading, title, href, onSettled }: EmbedProps) {
  const links = useContext(EmbedLinks)
  const parent = useContext(EmbedContext)
  const { data: note, isLoading } = useNote(noteId)
  // Nur einmal Bescheid geben – die Vorschau reicht bei jedem Rendern eine neue Funktion herein
  const latestOnSettled = useRef(onSettled)
  useEffect(() => {
    latestOnSettled.current = onSettled
  })
  const settled = useRef(false)
  const settle = useCallback(() => {
    if (settled.current) return
    settled.current = true
    latestOnSettled.current()
  }, [])
  useEffect(() => {
    if (!note && !isLoading) settle()
  }, [note, isLoading, settle])
  useEffect(() => {
    const timer = setTimeout(settle, MAX_WAIT_MS)
    return () => clearTimeout(timer)
  }, [settle])
  const inner = useMemo(() => ({ ...parent, chain: [...parent.chain, noteId] }), [parent, noteId])

  // Im Tresor steht als Titel nur ein Platzhalter – dann der Name aus dem Link
  const name = (note && !note.vault ? note.title : title) + (heading ? ` › ${heading}` : '')
  const open = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || !links) return
    e.preventDefault()
    links.onOpenNote(noteId, heading ?? undefined)
  }

  if (!note || !links) {
    return (
      <a className="embed-note" href={href} onClick={open}>
        <span className="embed-note-label">Eingebettet</span> {name}
      </a>
    )
  }
  return (
    <section className="note-embed-frame" aria-label={`Eingebettet aus „${name}“`} data-testid="note-embed">
      <p className="note-embed-source">
        Eingebettet aus{' '}
        <a href={note.vault ? `/?n=${noteId}` : href} onClick={open}>
          {name}
        </a>
      </p>
      <EmbedContext value={inner}>
        <NoteContent note={note} section={heading} links={links} embeds className="note-embed-body" onRendered={settle} />
      </EmbedContext>
    </section>
  )
}

/** Eingebettete Notizen in den Vorschauen darunter zeigen (`embeds`) – `noteId`: die einbettende Notiz */
export function NoteEmbeds({
  noteId,
  links,
  print,
  children,
}: {
  noteId: string
  links: PreviewLinks
  print?: boolean
  children: React.ReactNode
}) {
  const value = useMemo(() => ({ chain: [noteId], Embed: NoteEmbed, print }), [noteId, print])
  return (
    <EmbedLinks value={links}>
      <EmbedContext value={value}>{children}</EmbedContext>
    </EmbedLinks>
  )
}
