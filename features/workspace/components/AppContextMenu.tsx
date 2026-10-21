'use client'
import { ArrowLeft, Copy, ExternalLink, Image as ImageIcon, Link2, RotateCw } from 'lucide-react'
import { ContextMenuProvider, MenuItem, MenuLabel, MenuSeparator } from '@/shared/ui/menu'
import { useToast } from '@/shared/ui/toast'
import { copyText } from '@/shared/client/clipboard'

/**
 * Kontextmenüs der App. Bereiche mit eigenen Aktionen (Notizen, Editor, Dateien …) bringen ihr Menü selbst mit;
 * überall sonst gibt es dieses allgemeine – mit Kopieren, Links und Bildern wie im Menü des Browsers.
 */
export function AppContextMenu({ children }: { children: React.ReactNode }) {
  const toast = useToast()

  async function copy(text: string, message: string) {
    if (await copyText(text)) toast.success(message)
    else toast.error('Kopieren nicht möglich.')
  }

  function fallback(target: Element) {
    const selected = document.getSelection()?.toString() ?? ''
    const link = target.closest<HTMLAnchorElement>('a[href]')
    const image = target.closest<HTMLImageElement>('img[src]')
    return (
      <>
        {selected.trim() ? (
          <>
            <MenuItem icon={<Copy />} onSelect={() => void copy(selected, 'Kopiert.')} hint="Strg+C">
              Kopieren
            </MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        {link ? (
          <>
            <MenuItem icon={<ExternalLink />} onSelect={() => window.open(link.href, '_blank', 'noopener')}>
              Link in neuem Tab öffnen
            </MenuItem>
            <MenuItem icon={<Link2 />} onSelect={() => void copy(link.href, 'Link-Adresse kopiert.')}>
              Link-Adresse kopieren
            </MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        {image ? (
          <>
            <MenuItem icon={<ImageIcon />} onSelect={() => window.open(image.currentSrc || image.src, '_blank', 'noopener')}>
              Bild in neuem Tab öffnen
            </MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem icon={<ArrowLeft />} onSelect={() => history.back()}>
          Zurück
        </MenuItem>
        <MenuItem icon={<RotateCw />} onSelect={() => location.reload()}>
          Neu laden
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Umschalt + Rechtsklick: Menü des Browsers</MenuLabel>
      </>
    )
  }

  return <ContextMenuProvider fallback={fallback}>{children}</ContextMenuProvider>
}
