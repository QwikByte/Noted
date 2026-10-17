'use client'
import { useCallback, useMemo } from 'react'
import { useApp } from '@/features/workspace/client/context'
import { cn } from '@/shared/ui/cn'
import { renderMarkdown } from '@/shared/markdown/render'
import { sanitize } from '@/shared/markdown/sanitize'

/** Markdown einer Karteikarte (Formeln, Bilder, Code, Links auf Notizen und PDF-Seiten). */
export function CardMarkdown({ text, className }: { text: string; className?: string }) {
  const app = useApp()
  const resolveNote = useCallback(
    (target: string) => {
      const n = app.resolveTitle(target)
      return n ? { id: n.id, title: n.title } : null
    },
    [app],
  )
  const html = useMemo(() => sanitize(renderMarkdown(text, { resolveNote }).html), [text, resolveNote])

  function onClick(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest('a')
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return
    if (a.dataset.pdf) {
      e.preventDefault()
      app.openPdf(a.dataset.pdf, Number(a.dataset.page) || undefined)
    } else if (a.dataset.noteId) {
      e.preventDefault()
      app.go({ kind: 'note', id: a.dataset.noteId, heading: a.dataset.heading })
    } else if (a.classList.contains('tag')) {
      e.preventDefault()
      app.go({ kind: 'tag', tag: a.dataset.tag ?? '' })
    } else if (a.classList.contains('unresolved') || a.getAttribute('href') === '#') {
      e.preventDefault()
    }
  }

  return (
    <div
      className={cn('markdown-body card-markdown', className)}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
