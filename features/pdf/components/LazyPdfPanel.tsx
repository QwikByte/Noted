'use client'
// Der PDF-Viewer wird erst geladen, wenn ein PDF geöffnet wird. Fehlt sein Code offline (z. B. nach einem Update noch
// nicht geladen), erscheint eine Meldung statt eines Absturzes der ganzen App – mit Verbindung wird es erneut versucht.
import { useEffect, useState, type ComponentType } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { VIEWER_OFFLINE } from '../client/pdfjs'
import type { PdfPanelProps } from './PdfPanel'

type Panel = ComponentType<PdfPanelProps>
let loaded: Panel | null = null

/** PDF-Viewer (PdfPanel), bei Bedarf nachgeladen */
export function LazyPdfPanel(props: PdfPanelProps) {
  const [Panel, setPanel] = useState<Panel | null>(() => loaded)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    if (Panel) return
    let cancelled = false
    const load = () =>
      import('./PdfPanel').then(
        (m) => {
          loaded = m.default
          if (!cancelled) setPanel(() => m.default)
        },
        () => {
          if (!cancelled) setMessage(navigator.onLine === false ? VIEWER_OFFLINE : 'Der PDF-Viewer konnte nicht geladen werden.')
        },
      )
    void load()
    window.addEventListener('online', load)
    return () => {
      cancelled = true
      window.removeEventListener('online', load)
    }
  }, [Panel])

  if (Panel) return <Panel {...props} />
  if (!message) return null
  return (
    <section
      className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-subtle p-6 text-center text-sm text-muted"
      aria-label={`PDF: ${props.file}`}
      data-testid="pdf-panel"
    >
      <FileText className="size-8 text-faint" />
      <p>{message}</p>
      <Button size="sm" onClick={props.onClose}>
        Schließen
      </Button>
    </section>
  )
}
