'use client'
// KI in der Notizansicht: Assistent für die Markierung oder die ganze Notiz und Vorschläge für Titel und Tags. Liefert
// Menüeinträge und Dialoge; die Notizansicht reicht herein, wie sie den Inhalt ändert.
import { useEffect, useRef, useState } from 'react'
import { GraduationCap, Sparkles, Tags } from 'lucide-react'
import { useApp } from '@/features/workspace/client/context'
import { MenuItem } from '@/shared/ui/menu'
import { useToast } from '@/shared/ui/toast'
import { splitFrontmatter } from '@/shared/markdown/meta'
import { AiAssistant, type AssistScope } from '@/features/ai/components/AiAssistant'
import { AiMetaDialog } from '@/features/ai/components/AiMetaDialog'
import { useAiReady } from '@/features/ai/client/ai'
import type { AiSpan, NoteEditorHandle } from '../client/editor-handle'
import { withTags } from '../add-tags'
import { noteText } from '../format'
import type { NoteFormat } from '../types'

type RichText = typeof import('../client/rich-text')

/** Geöffneter Assistent: je Bereich die Markierung im Editor (null = ganze Notiz) */
type Open = { scopes: AssistScope[]; spans: (AiSpan | null)[]; rich: RichText | null }

const isMod = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey

export function useNoteAi({
  noteId,
  title,
  format,
  content,
  inVault,
  reading,
  rootRef,
  editorHandle,
  replaceContent,
  onTitleChange,
}: {
  noteId: string
  title: string
  format: NoteFormat
  content: string
  inVault: boolean
  /** Lesemodus: kein Editor, der Assistent arbeitet mit der ganzen Notiz */
  reading: boolean
  /** Notizansicht – Strg+J wirkt nur, wenn der Fokus darin liegt */
  rootRef: React.RefObject<HTMLElement | null>
  editorHandle: () => NoteEditorHandle | null
  /** Inhalt ersetzen wie eine Bearbeitung (wo ein Editor offen ist, mit Strg+Z rückgängig) und speichern */
  replaceContent: (next: string) => void
  onTitleChange: (title: string) => void
}) {
  const app = useApp()
  const toast = useToast()
  const ready = useAiReady()
  // Tresor-Notizen gehen nie an Claude; Mindmap und Canvas haben keinen Fließtext zum Umschreiben
  const canAssist = ready && !inVault && (format === 'markdown' || format === 'text' || format === 'richtext')
  const canMeta = ready && !inVault
  const [assistant, setAssistant] = useState<Open | null>(null)
  const [metaOpen, setMetaOpen] = useState(false)

  async function openAssistant() {
    if (!canAssist) return
    const span = reading ? null : (editorHandle()?.aiSelection?.() ?? null)
    // TipTap wird nur für formatierten Text geladen – die Umwandlung ebenso
    const rich = format === 'richtext' ? await import('../client/rich-text') : null
    const whole = rich ? rich.htmlToMarkdown(content) : (splitFrontmatter(content)?.body ?? content)
    const scopes: AssistScope[] = []
    const spans: (AiSpan | null)[] = []
    if (span?.markdown.trim()) {
      scopes.push({ label: 'Markierung', text: span.markdown, context: whole })
      spans.push(span)
    }
    scopes.push({ label: 'Ganze Notiz', text: whole })
    spans.push(null)
    setAssistant({ scopes, spans, rich })
  }

  // Strg/⌘+J: Assistent – solange der Fokus in der Notiz liegt
  const open = useRef(openAssistant)
  useEffect(() => {
    open.current = openAssistant
  })
  useEffect(() => {
    if (!canAssist) return
    const onKey = (e: KeyboardEvent) => {
      if (!isMod(e) || e.key.toLowerCase() !== 'j' || !rootRef.current?.contains(document.activeElement)) return
      e.preventDefault()
      void open.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [canAssist, rootRef])

  /** Ganze Notiz ersetzen – Properties (Frontmatter) bleiben, wie sie sind */
  function replaceWhole(markdown: string, rich: RichText | null) {
    if (rich) return replaceContent(rich.markdownToHtml(markdown))
    const fm = splitFrontmatter(content)
    replaceContent((fm ? content.slice(0, content.length - fm.body.length) : '') + markdown)
  }

  function appendWhole(markdown: string, rich: RichText | null) {
    if (rich) return replaceContent(content + rich.markdownToHtml(markdown))
    replaceContent(`${content.replace(/\s+$/, '')}${content.trim() ? '\n\n' : ''}${markdown}\n`)
  }

  const menuItems = (
    <>
      {canAssist ? (
        <MenuItem icon={<Sparkles />} onSelect={() => void openAssistant()} hint="Strg+J">
          KI-Assistent …
        </MenuItem>
      ) : null}
      {canMeta ? (
        <>
          <MenuItem icon={<Tags />} onSelect={() => setMetaOpen(true)}>
            Titel und Tags vorschlagen …
          </MenuItem>
          <MenuItem icon={<GraduationCap />} onSelect={() => app.go({ kind: 'quiz', id: noteId, ai: true })}>
            Mit KI abfragen
          </MenuItem>
        </>
      ) : null}
    </>
  )

  const dialogs = (
    <>
      {assistant ? (
        <AiAssistant
          title={title}
          noteId={noteId}
          plain={format === 'text'}
          scopes={assistant.scopes}
          onReplace={(i, markdown) => {
            const span = assistant.spans[i]
            if (span) return editorHandle()?.applyAi?.(span, markdown, 'replace') ?? false
            replaceWhole(markdown, assistant.rich)
            return true
          }}
          onInsert={(i, markdown) => {
            const span = assistant.spans[i]
            if (span) return editorHandle()?.applyAi?.(span, markdown, 'after') ?? false
            appendWhole(markdown, assistant.rich)
            return true
          }}
          onClose={() => setAssistant(null)}
        />
      ) : null}
      {metaOpen ? (
        <AiMetaDialog
          note={{ id: noteId, title, content: noteText(format, content) }}
          canTag={format !== 'canvas'}
          onApply={({ title: next, tags }) => {
            if (next) onTitleChange(next)
            if (tags.length) replaceContent(withTags(format, content, tags))
            toast.success('Übernommen.')
          }}
          onClose={() => setMetaOpen(false)}
        />
      ) : null}
    </>
  )

  return { canAssist, openAssistant: () => void openAssistant(), menuItems, dialogs }
}
