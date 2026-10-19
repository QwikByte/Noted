'use client'
// Graph der Wikilinks: Gesamtansicht mit Filtern und lokaler Graph einer Notiz. Nur Anzeige – React Flow zeichnet,
// die Anordnung berechnet layoutGraph.
import { useEffect, useId, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { Loader2, Maximize, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { useFolders, useTags } from '@/features/notes/client/queries'
import { descendantFolderIds, folderPath } from '@/features/notes/tree'
import { ToolButton } from '@/features/notes/components/toolbar'
import type { Folder } from '@/features/notes/types'
import { FLOW_ARIA_LABELS, FLOW_PRO_OPTIONS } from '@/shared/ui/flow'
import { Select } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { useReservedSpace } from '@/shared/ui/reserved-space'
import { usePref } from '@/shared/client/prefs'
import { errorMessage } from '@/shared/client/api'
import { useGraph } from '../client/queries'
import { layoutGraph, neighborhood } from '../layout'
import { GRAPH_NODE_LIMIT, filterGraph, nodeSize, rootColors } from '../filter'
import type { GraphData } from '../types'

type NoteNodeData = { title: string; size: number; color: string; match: boolean; center: boolean }
type NoteFlowNode = Node<NoteNodeData, 'note'>

/** Punkt mit Titel darunter. Die unsichtbaren Anschlüsse liegen in der Mitte, die Kanten verbinden die Mittelpunkte. */
function NoteNode({ data }: NodeProps<NoteFlowNode>) {
  return (
    <div
      className={cn('graph-node', data.match && 'graph-match', data.center && 'graph-center')}
      style={{ width: data.size, height: data.size, background: data.color }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
      <span className="graph-label">{data.title}</span>
    </div>
  )
}

const nodeTypes = { note: NoteNode }

/** Ab dieser Zoomstufe stehen die Titel an allen Knoten */
const LABEL_ZOOM = 0.6

/** Farbe je oberstem Ordner (Palette des Kalenders); Notizen ohne Ordner in Grau */
function useFolderColor(folders: Folder[]) {
  return useMemo(() => {
    const colors = rootColors(folders.filter((f) => f.parentId === null))
    return (folderId: string | null) => {
      const root = folderPath(folders, folderId)[0]
      const n = root ? colors.get(root.id) : undefined
      return n ? `var(--swatch-${n})` : 'var(--text-faint)'
    }
  }, [folders])
}

function GraphCanvas({
  graph,
  query = '',
  centerId,
  fullPage,
  onOpen,
}: {
  graph: GraphData
  /** Titel, die das enthalten, werden hervorgehoben */
  query?: string
  /** Notiz in der Mitte des lokalen Graphen */
  centerId?: string
  /** Über die ganze Seite: Werkzeugleiste und Mini-Timer weichen den Zoom-Knöpfen aus */
  fullPage?: boolean
  onOpen: (id: string) => void
}) {
  const flow = useReactFlow()
  const zoomSpace = useReservedSpace<HTMLDivElement>('--bottom-right-height')
  const scope = useId()
  const { data: folders = [] } = useFolders()
  const colorOf = useFolderColor(folders)
  const [hover, setHover] = useState<string | null>(null)
  const showLabels = useStore((s) => s.transform[2] >= LABEL_ZOOM)

  const positions = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph])
  const q = query.trim().toLowerCase()
  const nodes = useMemo<NoteFlowNode[]>(
    () =>
      graph.nodes.map((n) => {
        const size = nodeSize(n.links)
        const p = positions.get(n.id) ?? { x: 0, y: 0 }
        return {
          id: n.id,
          type: 'note',
          position: { x: p.x - size / 2, y: p.y - size / 2 },
          data: {
            title: n.title,
            size,
            color: colorOf(n.folderId),
            match: q !== '' && n.title.toLowerCase().includes(q),
            center: n.id === centerId,
          },
          ariaLabel: n.title,
        }
      }),
    [graph, positions, colorOf, q, centerId],
  )
  const edges = useMemo<Edge[]>(
    () => graph.edges.map((e) => ({ id: `${e.source}>${e.target}`, source: e.source, target: e.target, type: 'straight' })),
    [graph],
  )
  const neighbors = useMemo(() => {
    const map = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]))
    for (const e of graph.edges) {
      map.get(e.source)?.push(e.target)
      map.get(e.target)?.push(e.source)
    }
    return map
  }, [graph])

  // Neue Auswahl (Filter, Tiefe): wieder alles einpassen
  useEffect(() => {
    const frame = requestAnimationFrame(() => void flow.fitView({ padding: 0.15, maxZoom: 1.5, duration: 150 }))
    return () => cancelAnimationFrame(frame)
  }, [graph, flow])

  // Hervorheben beim Überfahren per CSS statt über die Knotendaten – sonst würde jeder Knoten neu gezeichnet
  const hoverCss = useMemo(() => {
    if (!hover || !positions.has(hover)) return ''
    const root = `[data-graph=${JSON.stringify(scope)}]`
    const ids = [hover, ...(neighbors.get(hover) ?? [])].map((id) => JSON.stringify(id))
    const id = JSON.stringify(hover).slice(1, -1)
    return `${root} .react-flow__node { opacity: 0.25 }
      ${ids.map((i) => `${root} .react-flow__node[data-id=${i}]`).join(',')} { opacity: 1 }
      ${ids.map((i) => `${root} .react-flow__node[data-id=${i}] .graph-label`).join(',')} { display: block }
      ${root} .react-flow__edge { opacity: 0.15 }
      ${root} .react-flow__edge[data-id^="${id}>"], ${root} .react-flow__edge[data-id$=">${id}"] { opacity: 1 }
      ${root} .react-flow__edge[data-id^="${id}>"] path, ${root} .react-flow__edge[data-id$=">${id}"] path {
        stroke: var(--accent); stroke-width: 1.5 }`
  }, [hover, neighbors, positions, scope])

  return (
    <div
      className={cn('graph-flow flow-surface h-full', q && 'graph-searching')}
      data-graph={scope}
      data-labels={showLabels ? 'on' : 'off'}
      data-testid="graph"
    >
      {hoverCss ? <style>{hoverCss}</style> : null}
      <ReactFlow<NoteFlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_e, n) => {
          if (n.id !== centerId) onOpen(n.id)
        }}
        onNodeMouseEnter={(_e, n) => setHover(n.id)}
        onNodeMouseLeave={() => setHover(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnDoubleClick={false}
        onlyRenderVisibleElements
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.5 }}
        minZoom={0.05}
        maxZoom={3}
        ariaLabelConfig={FLOW_ARIA_LABELS}
        proOptions={FLOW_PRO_OPTIONS}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} />
        <Panel ref={fullPage ? zoomSpace : undefined} position="bottom-right" className="flow-panel">
          <ToolButton label="Verkleinern" keepFocus={false} onClick={() => void flow.zoomOut({ duration: 150 })}>
            <ZoomOut />
          </ToolButton>
          <ToolButton label="Vergrößern" keepFocus={false} onClick={() => void flow.zoomIn({ duration: 150 })}>
            <ZoomIn />
          </ToolButton>
          <ToolButton
            label="Alles anzeigen"
            keepFocus={false}
            onClick={() => void flow.fitView({ padding: 0.15, maxZoom: 1.5, duration: 200 })}
          >
            <Maximize />
          </ToolButton>
        </Panel>
      </ReactFlow>
    </div>
  )
}

/** Gesamtgraph aller Notizen, filterbar nach Ordner (samt Unterordnern) und Tag */
export default function GraphView() {
  const app = useApp()
  const { data, isLoading, error } = useGraph()
  const { data: folders = [] } = useFolders()
  const { data: tags = [] } = useTags()
  const [folder, setFolder] = useState('')
  const [tag, setTag] = useState('')
  const [query, setQuery] = useState('')

  const folderOptions = useMemo(
    () =>
      folders
        .map((f) => ({ id: f.id, label: folderPath(folders, f.id).map((p) => p.name).join(' / ') }))
        .sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base', numeric: true })),
    [folders],
  )
  const graph = useMemo(() => {
    if (!data) return null
    const folderIds = folder && folders.some((f) => f.id === folder) ? descendantFolderIds(folders, folder) : null
    return filterGraph(data, { folderIds, tag: tag || null })
  }, [data, folders, folder, tag])
  const tooMany = !!graph && graph.nodes.length >= GRAPH_NODE_LIMIT
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return graph && q ? graph.nodes.filter((n) => n.title.toLowerCase().includes(q)).length : null
  }, [graph, query])

  return (
    <div className="flex h-full flex-col" data-testid="graph-view">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <h1 className="mr-auto text-xl font-bold tracking-tight">Graph</h1>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Ordner" className="h-9 sm:w-56">
            <option value="">Alle Ordner</option>
            {folderOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag" className="h-9 sm:w-44">
            <option value="">Alle Tags</option>
            {tags.map((t) => (
              <option key={t.tag} value={t.tag}>
                #{t.tag}
              </option>
            ))}
          </Select>
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Notiz hervorheben …"
            aria-label="Notiz im Graphen hervorheben"
            className="h-9 w-full rounded-lg border border-border-strong/70 bg-elevated pr-3 pl-9 text-sm outline-none placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent/20"
          />
        </div>
      </div>
      {graph ? (
        <p className="border-b border-border px-4 py-1.5 text-xs text-muted" aria-live="polite">
          {graph.nodes.length.toLocaleString('de-DE')} {graph.nodes.length === 1 ? 'Notiz' : 'Notizen'} ·{' '}
          {graph.edges.length.toLocaleString('de-DE')} {graph.edges.length === 1 ? 'Verbindung' : 'Verbindungen'}
          {matches !== null ? ` · ${matches} Treffer` : ''}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        {!graph ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
            {isLoading ? (
              <Loader2 className="size-6 animate-spin text-faint" />
            ) : (
              `Der Graph konnte nicht geladen werden. ${errorMessage(error)}`
            )}
          </div>
        ) : tooMany ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
            <p className="max-w-sm">
              {graph.nodes.length.toLocaleString('de-DE')} Notizen sind zu viele für eine übersichtliche Darstellung.
              Wähle einen Ordner oder Tag, um einen Ausschnitt zu sehen.
            </p>
          </div>
        ) : graph.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
            Keine Notizen für diese Auswahl.
          </div>
        ) : (
          <ReactFlowProvider>
            <GraphCanvas graph={graph} query={query} fullPage onOpen={(id) => app.go({ kind: 'note', id })} />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  )
}

/** Lokaler Graph einer Notiz: direkt verlinkte Notizen (Tiefe 1) oder auch deren Nachbarn (Tiefe 2) */
export function LocalGraph({ noteId }: { noteId: string }) {
  const app = useApp()
  const { data, isLoading, error } = useGraph()
  const [depth, setDepth] = usePref<'1' | '2'>('noted:graphDepth', '1')
  const graph = useMemo(() => (data ? neighborhood(data, noteId, depth === '2' ? 2 : 1) : null), [data, noteId, depth])

  return (
    <div>
      <div className="flex items-center gap-2 px-4 pb-2">
        <div className="flex rounded-lg bg-hover p-0.5 text-xs" role="radiogroup" aria-label="Tiefe">
          {(['1', '2'] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={depth === d}
              onClick={() => setDepth(d)}
              className={cn(
                'rounded-md px-2 py-1 font-medium transition-colors',
                depth === d ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg',
              )}
            >
              {d === '1' ? 'Direkt verlinkt' : 'Zwei Schritte'}
            </button>
          ))}
        </div>
        {graph ? (
          <span className="text-xs text-faint">
            {graph.nodes.length - 1} {graph.nodes.length === 2 ? 'Notiz' : 'Notizen'}
          </span>
        ) : null}
      </div>
      <div className="h-72 overflow-hidden rounded-b-lg border-t border-border">
        {graph && graph.nodes.length > 0 ? (
          <ReactFlowProvider>
            <GraphCanvas graph={graph} centerId={noteId} onOpen={(id) => app.go({ kind: 'note', id })} />
          </ReactFlowProvider>
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted">
            {isLoading ? (
              <Loader2 className="size-5 animate-spin text-faint" />
            ) : error ? (
              `Der Graph konnte nicht geladen werden. ${errorMessage(error)}`
            ) : (
              'Die Notiz ist noch nicht gespeichert.'
            )}
          </div>
        )}
      </div>
    </div>
  )
}
