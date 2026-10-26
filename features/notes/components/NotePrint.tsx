'use client'
// Druckansicht einer Notiz – immer die Leseansicht, auch aus dem Bearbeiten heraus, mit dem aktuellen Stand im Editor
import { useMemo, useState } from 'react'
import { PrintOption, PrintView } from '@/shared/ui/print-view'
import { usePref } from '@/shared/client/prefs'
import { Preview, type PreviewLinks } from './Preview'
import { NoteEmbeds } from './NoteEmbed'
import { PlainTextView, RichTextView } from './ReadView'
import { noteMarkdownForPrint } from '../print'
import type { NoteFormat } from '../types'

const NOTICES: Partial<Record<NoteFormat, string>> = {
  mindmap: 'Die Mindmap wird als Gliederung gedruckt.',
  canvas: 'Das Canvas wird als Text der Karten gedruckt – ohne Anordnung und Pfeile.',
}

const ignore = () => {}

export function NotePrint({
  noteId,
  title,
  format,
  content,
  links,
  onClose,
}: {
  /** Die gedruckte Notiz – eingebettete Notizen werden mitgedruckt */
  noteId: string
  title: string
  format: NoteFormat
  content: string
  links: PreviewLinks
  onClose: () => void
}) {
  const [showTitle, setShowTitle] = usePref<'1' | '0'>('noted:print:title', '1')
  const [properties, setProperties] = usePref<'1' | '0'>('noted:print:properties', '0')
  const [compact, setCompact] = usePref<'1' | '0'>('noted:print:compact', '0')
  const { markdown, hasProperties } = useMemo(
    () => noteMarkdownForPrint(format, content, { properties: properties === '1' }),
    [format, content, properties],
  )
  // Markdown ist fertig, wenn die Diagramme und eingebetteten Notizen dieses Inhalts gerendert sind
  const [renderedFor, setRenderedFor] = useState<string | null>(null)
  // Bei Mindmaps ist die Wurzel (#) schon die Überschrift
  const withTitle = format !== 'mindmap'

  return (
    <PrintView
      title={title}
      heading={withTitle && showTitle === '1' ? title : undefined}
      compact={compact === '1'}
      ready={markdown === null || renderedFor === markdown}
      notice={NOTICES[format]}
      onClose={onClose}
      options={
        <>
          {withTitle ? (
            <PrintOption label="Titel" checked={showTitle === '1'} onChange={(v) => setShowTitle(v ? '1' : '0')} />
          ) : null}
          {hasProperties ? (
            <PrintOption label="Properties" checked={properties === '1'} onChange={(v) => setProperties(v ? '1' : '0')} />
          ) : null}
          <PrintOption label="Kompakt" checked={compact === '1'} onChange={(v) => setCompact(v ? '1' : '0')} />
        </>
      }
    >
      {markdown !== null ? (
        <NoteEmbeds noteId={noteId} links={links} print>
          <Preview content={markdown} {...links} print embeds onRendered={() => setRenderedFor(markdown)} />
        </NoteEmbeds>
      ) : format === 'richtext' ? (
        <RichTextView html={content} onOpenPdf={ignore} />
      ) : (
        <PlainTextView text={content} />
      )}
    </PrintView>
  )
}
