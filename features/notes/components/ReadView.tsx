'use client'
// Lesemodus für formatierten und einfachen Text (Markdown zeigt Preview.tsx)
import { useMemo } from 'react'
import { sanitize } from '@/shared/markdown/sanitize'
import { attachmentFromUrl } from '../rich-html'

/** Formatierter Text – bereinigt, Links auf PDFs öffnen im eingebauten Viewer */
export function RichTextView({
  html,
  lang,
  onOpenPdf,
}: {
  html: string
  lang?: string
  onOpenPdf: (file: string, page?: number) => void
}) {
  const clean = useMemo(() => sanitize(html), [html])

  function onClick(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest('a')
    const file = a ? attachmentFromUrl(a.getAttribute('href') ?? '') : null
    if (!a || !file) return
    e.preventDefault()
    if (/\.pdf$/i.test(file.name)) onOpenPdf(file.name, file.page ?? undefined)
    else window.open(a.href, '_blank', 'noopener')
  }

  return (
    <div
      className="markdown-body rich-text"
      lang={lang}
      onClick={onClick}
      data-testid="rich-view"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}

/** Einfacher Text – genau so, wie er geschrieben wurde */
export function PlainTextView({ text, lang }: { text: string; lang?: string }) {
  return (
    <div className="plain-text" lang={lang} data-testid="plain-view">
      {text}
    </div>
  )
}
