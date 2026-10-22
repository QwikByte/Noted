'use client'
// Kontextmenüs auf dem Blatt einer Notiz: Bearbeiten-Befehle wie im Menü des Browsers (Markdown, formatierter Text)
// und im Lesemodus Links, Markierung und Karteikarten
import { redo, selectAll, undo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import {
  Bold,
  ClipboardPaste,
  Copy,
  ExternalLink,
  FileText,
  FilePlus,
  Hash,
  Highlighter,
  Italic,
  Layers,
  Link2,
  PenLine,
  Redo2,
  Scissors,
  TextSelect,
  Undo2,
} from 'lucide-react'
import { viewToUrl } from '@/features/workspace/client/nav'
import { MenuItem, MenuSeparator } from '@/shared/ui/menu'
import { useToast } from '@/shared/ui/toast'
import { copyText, readText } from '@/shared/client/clipboard'
import { insertLink, wrapSelection } from '../client/editor/commands'
import { attachmentFromUrl } from '../rich-html'
import type { PreviewLinks } from './Preview'

/** Wo die Befehle wirken. Ausschneiden und Kopieren laufen über den Editor selbst (er schreibt Text und Format). */
type EditTarget = {
  focus: () => void
  hasSelection: boolean
  paste: (text: string) => void
  selectAll: () => void
  undo: () => void
  redo: () => void
}

export function EditMenuItems({ target }: { target: EditTarget }) {
  const toast = useToast()
  // Der Fokus liegt noch im Editor (das Menü nimmt ihn nicht) – so greifen die Befehle des Browsers auf die Markierung
  const exec = (command: 'cut' | 'copy') => {
    target.focus()
    if (!document.execCommand(command)) toast.error('Das geht hier nur mit der Tastatur (Strg+X / Strg+C).')
  }
  return (
    <>
      <MenuItem icon={<Undo2 />} onSelect={target.undo} hint="Strg+Z">
        Rückgängig
      </MenuItem>
      <MenuItem icon={<Redo2 />} onSelect={target.redo} hint="Strg+Y">
        Wiederholen
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Scissors />} onSelect={() => exec('cut')} disabled={!target.hasSelection} hint="Strg+X">
        Ausschneiden
      </MenuItem>
      <MenuItem icon={<Copy />} onSelect={() => exec('copy')} disabled={!target.hasSelection} hint="Strg+C">
        Kopieren
      </MenuItem>
      <MenuItem
        icon={<ClipboardPaste />}
        onSelect={async () => {
          const text = await readText()
          if (text === null) toast.error('Der Browser erlaubt das Einfügen nur mit Strg+V.')
          else target.paste(text)
        }}
        hint="Strg+V"
      >
        Einfügen
      </MenuItem>
      <MenuItem icon={<TextSelect />} onSelect={target.selectAll} hint="Strg+A">
        Alles auswählen
      </MenuItem>
    </>
  )
}

/** Rechtsklick im Markdown- oder Text-Editor: Bearbeiten, bei Markdown auch Formatieren, und eine Karteikarte */
export function MarkdownEditorMenu({
  view,
  markdown,
  onCreateCard,
}: {
  view: EditorView
  markdown: boolean
  onCreateCard: () => void
}) {
  const run = (fn: (v: EditorView) => unknown) => () => {
    fn(view)
    view.focus()
  }
  const hasSelection = !view.state.selection.main.empty
  return (
    <>
      <EditMenuItems
        target={{
          focus: () => view.focus(),
          hasSelection,
          paste: (text) => {
            view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true })
            view.focus()
          },
          selectAll: run(selectAll),
          undo: run(undo),
          redo: run(redo),
        }}
      />
      {markdown ? (
        <>
          <MenuSeparator />
          <MenuItem icon={<Bold />} onSelect={run((v) => wrapSelection(v, '**', '**', 'fett'))} hint="Strg+B">
            Fett
          </MenuItem>
          <MenuItem icon={<Italic />} onSelect={run((v) => wrapSelection(v, '*', '*', 'kursiv'))} hint="Strg+I">
            Kursiv
          </MenuItem>
          <MenuItem icon={<Highlighter />} onSelect={run((v) => wrapSelection(v, '==', '==', 'wichtig'))}>
            Markieren
          </MenuItem>
          <MenuItem icon={<Link2 />} onSelect={run(insertLink)}>
            Wikilink [[ ]]
          </MenuItem>
        </>
      ) : null}
      <MenuSeparator />
      <MenuItem icon={<Layers />} onSelect={onCreateCard}>
        {hasSelection ? 'Karteikarte aus Markierung' : 'Karteikarte erstellen'}
      </MenuItem>
    </>
  )
}

/**
 * Rechtsklick im Lesemodus und in der Vorschau: Was der Link unter dem Zeiger kann (wie ein Klick darauf), die
 * Markierung und der Wechsel zum Bearbeiten.
 */
export function ReadViewMenu({
  target,
  links,
  onCreateCard,
  onEdit,
}: {
  target: Element
  links: PreviewLinks
  onCreateCard: () => void
  /** Zum Bearbeiten wechseln – fehlt in der geteilten Ansicht, dort steht der Editor daneben */
  onEdit?: () => void
}) {
  const toast = useToast()
  const a = target.closest<HTMLAnchorElement>('a[href]')
  const href = a?.getAttribute('href') ?? ''
  const file = a ? attachmentFromUrl(href) : null
  const pdf = a?.dataset.pdf ?? (file && /\.pdf$/i.test(file.name) ? file.name : null)
  const page = Number(a?.dataset.page) || file?.page || undefined
  const selected = document.getSelection()?.toString().trim() ?? ''

  async function copy(text: string, message: string) {
    if (await copyText(text)) toast.success(message)
    else toast.error('Kopieren nicht möglich.')
  }

  let linkItems: React.ReactNode = null
  if (a && pdf && links.onOpenPdf) {
    const open = links.onOpenPdf
    linkItems = (
      <MenuItem icon={<FileText />} onSelect={() => open(pdf, page)}>
        PDF daneben öffnen
      </MenuItem>
    )
  } else if (a?.classList.contains('tag')) {
    linkItems = (
      <MenuItem icon={<Hash />} onSelect={() => links.onOpenTag(a.dataset.tag ?? '')}>
        Tag „{a.dataset.tag}“ anzeigen
      </MenuItem>
    )
  } else if (a?.dataset.noteId) {
    const { noteId, heading } = a.dataset
    linkItems = (
      <>
        <MenuItem icon={<FileText />} onSelect={() => links.onOpenNote(noteId, heading)}>
          Notiz öffnen
        </MenuItem>
        <MenuItem
          icon={<ExternalLink />}
          onSelect={() => {
            // Überschriften aus dem Tresor nicht in die Adresse (Browserverlauf)
            const target = links.isVaultNote?.(noteId) ? undefined : heading
            window.open(viewToUrl({ kind: 'note', id: noteId, heading: target }), '_blank', 'noopener')
          }}
        >
          In neuem Tab öffnen
        </MenuItem>
      </>
    )
  } else if (a?.classList.contains('unresolved') && a.dataset.target) {
    const title = a.dataset.target
    linkItems = (
      <MenuItem icon={<FilePlus />} onSelect={() => links.onCreateNote(title)}>
        Notiz „{title}“ anlegen
      </MenuItem>
    )
  } else if (a && !href.startsWith('#')) {
    linkItems = (
      <>
        <MenuItem icon={<ExternalLink />} onSelect={() => window.open(a.href, '_blank', 'noopener')}>
          Link in neuem Tab öffnen
        </MenuItem>
        <MenuItem icon={<Link2 />} onSelect={() => void copy(a.href, 'Link-Adresse kopiert.')}>
          Link-Adresse kopieren
        </MenuItem>
      </>
    )
  }

  return (
    <>
      {linkItems ? (
        <>
          {linkItems}
          <MenuSeparator />
        </>
      ) : null}
      {selected ? (
        <MenuItem icon={<Copy />} onSelect={() => void copy(selected, 'Kopiert.')} hint="Strg+C">
          Kopieren
        </MenuItem>
      ) : null}
      <MenuItem icon={<Layers />} onSelect={onCreateCard}>
        {selected ? 'Karteikarte aus Markierung' : 'Karteikarte erstellen'}
      </MenuItem>
      {onEdit ? (
        <>
          <MenuSeparator />
          <MenuItem icon={<PenLine />} onSelect={onEdit}>
            Bearbeiten
          </MenuItem>
        </>
      ) : null}
    </>
  )
}
