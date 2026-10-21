'use client'
// Darstellung der Karten und Pfeile eines Canvas in React Flow
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  Position,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { ExternalLink, File as FileIcon, FileText, Link2, Loader2 } from 'lucide-react'
import { MIN_NODE_SIZE, type CanvasNode, type CanvasSide } from '../canvas'
import { Preview, type PreviewLinks } from '@/features/notes/components/Preview'
import { PlainTextView, RichTextView } from '@/features/notes/components/ReadView'
import { useNote } from '@/features/notes/client/queries'
import { mindmapToMarkdown } from '@/features/mindmap/mindmap'
import { defaultFileUrl } from '@/shared/markdown/syntax'
import type { Attachment } from '@/features/attachments/types'
import { cn } from '@/shared/ui/cn'

export type CardNode = Node<{ node: CanvasNode }, 'card'>
export type ArrowEdge = Edge<{ label?: string; color?: string }, 'arrow'>

/** Worauf eine Dateikarte zeigt */
export type ResolvedFile =
  | { kind: 'attachment'; attachment: Attachment }
  | { kind: 'note'; id: string; title: string }
  | { kind: 'missing' }

type CanvasContextValue = {
  readOnly: boolean
  /** Karte oder Pfeil, deren Text gerade bearbeitet wird */
  editingId: string | null
  /** Ziel beim Verbinden mit der Tastatur */
  connectTarget: string | null
  links: PreviewLinks
  resolveFile: (file: string) => ResolvedFile
  commitText: (id: string, text: string) => void
}

export const CanvasContext = createContext<CanvasContextValue | null>(null)

/** Farbe aus der Datei: „1“ bis „6“ (Farbpalette von JSON Canvas) oder ein Hex-Wert */
export function canvasColor(color: string | undefined): string | undefined {
  if (!color) return undefined
  if (/^[1-6]$/.test(color)) return `var(--swatch-${color})`
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined
}

/** Nur Web-Adressen sind anklickbar – ein importiertes Canvas könnte sonst z. B. javascript:-Links enthalten */
export const safeUrl = (url: string) => (/^https?:\/\/[^\s]+$/i.test(url) ? url : null)

const SIDES: [CanvasSide, Position][] = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
]

/** Scrollbarer Inhalt: Mausrad scrollt den Inhalt statt die Fläche, sobald er überläuft */
function Scroll({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 1)
    const ro = new ResizeObserver(check)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className={cn('canvas-scroll', overflowing && 'nowheel', className)}>
      <div>{children}</div>
    </div>
  )
}

function CardTextarea({ id, initial, placeholder }: { id: string; initial: string; placeholder: string }) {
  const ctx = useContext(CanvasContext)!
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  // Sofort fokussieren, damit schnell getippte Zeichen nicht verloren gehen
  useLayoutEffect(() => {
    const el = ref.current
    el?.focus({ preventScroll: true })
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const finish = () => {
    if (done.current) return
    done.current = true
    ctx.commitText(id, value)
  }
  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      aria-label="Text der Karte"
      className="canvas-input nodrag nowheel"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          finish()
        }
      }}
      onBlur={finish}
    />
  )
}

function LineInput({ id, initial, placeholder, className }: { id: string; initial: string; placeholder: string; className?: string }) {
  const ctx = useContext(CanvasContext)!
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = () => {
    if (done.current) return
    done.current = true
    ctx.commitText(id, value)
  }
  return (
    <input
      // Wird erst beim Bearbeiten eingeblendet – dann soll man direkt tippen können
      autoFocus
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      className={cn('nodrag', className)}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          finish()
        }
      }}
      onBlur={finish}
    />
  )
}

function NoteBody({ id, title }: { id: string; title: string }) {
  const ctx = useContext(CanvasContext)!
  const { data: note, isLoading } = useNote(id)
  const open = ctx.links.onOpenPdf ?? (() => {})
  return (
    <div className="canvas-note">
      <button type="button" className="canvas-note-title nodrag" onClick={() => ctx.links.onOpenNote(id)} title="Notiz öffnen">
        <FileText className="size-3.5 shrink-0" />
        <span className="truncate">{title}</span>
      </button>
      <Scroll>
        {!note ? (
          isLoading ? (
            <Loader2 className="m-3 size-4 animate-spin text-faint" />
          ) : (
            <p className="p-3 text-sm text-muted">Nicht verfügbar</p>
          )
        ) : note.format === 'richtext' ? (
          <RichTextView html={note.content} onOpenPdf={open} />
        ) : note.format === 'text' ? (
          <PlainTextView text={note.content} />
        ) : note.format === 'canvas' ? (
          <p className="p-3 text-sm text-muted">{note.excerpt || 'Canvas'}</p>
        ) : (
          <Preview
            content={note.format === 'mindmap' ? mindmapToMarkdown(note.content) : note.content}
            {...ctx.links}
            className="card-markdown"
          />
        )}
      </Scroll>
    </div>
  )
}

function FileBody({ node }: { node: Extract<CanvasNode, { type: 'file' }> }) {
  const ctx = useContext(CanvasContext)!
  const file = ctx.resolveFile(node.file)
  if (file.kind === 'note') return <NoteBody id={file.id} title={file.title} />
  if (file.kind === 'missing') {
    return (
      <div className="canvas-row is-missing">
        <FileIcon className="size-4 shrink-0" />
        <span className="min-w-0 break-words">„{node.file}“ nicht gefunden</span>
      </div>
    )
  }
  const { filename, mime } = file.attachment
  const url = defaultFileUrl(filename)
  if (mime.startsWith('image/')) {
    // eslint-disable-next-line @next/next/no-img-element -- Anhänge kommen von der eigenen API, nicht aus next/image
    return <img src={url} alt={filename} className="canvas-image" draggable={false} />
  }
  const isPdf = mime === 'application/pdf'
  const page = /^#page=(\d{1,5})$/.exec(node.subpath ?? '')?.[1]
  const open = () => {
    if (isPdf && ctx.links.onOpenPdf) ctx.links.onOpenPdf(filename, page ? Number(page) : undefined)
    else window.open(url, '_blank', 'noopener')
  }
  return (
    <div className="canvas-row">
      {isPdf ? <FileText className="size-4 shrink-0 text-danger" /> : <FileIcon className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1 truncate" title={filename}>
        {filename}
        {page ? `, S. ${page}` : ''}
      </span>
      <button
        type="button"
        className="canvas-file-open nodrag"
        onClick={open}
      >
        Öffnen
      </button>
    </div>
  )
}

function LinkBody({ url }: { url: string }) {
  const href = safeUrl(url)
  let host = url
  try {
    host = new URL(url).host || url
  } catch {
    /* kein gültiger Link – Text anzeigen */
  }
  return (
    <div className="canvas-row">
      <Link2 className="size-4 shrink-0 text-accent-text" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{host}</div>
        <div className="truncate text-xs text-muted">{url}</div>
      </div>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="canvas-file-open nodrag" aria-label="Link öffnen">
          <ExternalLink className="size-3.5" />
        </a>
      ) : null}
    </div>
  )
}

function CardView({ id, data, selected }: NodeProps<CardNode>) {
  const ctx = useContext(CanvasContext)!
  const n = data.node
  const color = canvasColor(n.color)
  const editing = ctx.editingId === id
  return (
    <div
      className={cn(
        'canvas-card',
        `canvas-${n.type}`,
        selected && 'is-selected',
        color && 'has-color',
        editing && 'is-editing',
        ctx.connectTarget === id && 'is-connect-target outline-2 outline-offset-4 outline-accent outline-dashed',
      )}
      style={color ? ({ '--card': color } as React.CSSProperties) : undefined}
      data-testid={`canvas-${n.type}`}
    >
      {ctx.readOnly ? null : (
        <NodeResizer isVisible={selected && !editing} minWidth={MIN_NODE_SIZE} minHeight={MIN_NODE_SIZE} color="var(--accent)" />
      )}
      {SIDES.map(([side, position]) => (
        <Handle key={side} id={side} type="source" position={position} className="canvas-handle" isConnectable={!ctx.readOnly} />
      ))}
      {n.type === 'text' ? (
        editing ? (
          <CardTextarea id={id} initial={n.text} placeholder="Markdown, [[Links]], #Tags …" />
        ) : (
          <Scroll>
            {n.text.trim() ? (
              <Preview content={n.text} {...ctx.links} className="card-markdown" />
            ) : (
              <p className="canvas-empty">Leere Karte</p>
            )}
          </Scroll>
        )
      ) : n.type === 'file' ? (
        <FileBody node={n} />
      ) : n.type === 'link' ? (
        <LinkBody url={n.url} />
      ) : (
        <div className="canvas-group-label">
          {editing ? (
            <LineInput id={id} initial={n.label ?? ''} placeholder="Name der Gruppe" className="canvas-group-input" />
          ) : (
            n.label || 'Gruppe'
          )}
        </div>
      )}
    </div>
  )
}

function ArrowEdgeView(props: EdgeProps<ArrowEdge>) {
  const { id, markerEnd, markerStart, data, selected } = props
  const ctx = useContext(CanvasContext)!
  const [path, labelX, labelY] = getBezierPath(props)
  const color = canvasColor(data?.color) ?? 'var(--edge)'
  const editing = ctx.editingId === id
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={24}
        style={{ stroke: color, strokeWidth: selected ? 3 : 2 }}
      />
      {data?.label || editing ? (
        <EdgeLabelRenderer>
          <div
            className={cn('canvas-edge-label nodrag nopan', selected && 'is-selected')}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {editing ? (
              <LineInput id={id} initial={data?.label ?? ''} placeholder="Beschriftung" className="canvas-edge-input" />
            ) : (
              data?.label
            )}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

export const nodeTypes = { card: CardView }
export const edgeTypes = { arrow: ArrowEdgeView }
