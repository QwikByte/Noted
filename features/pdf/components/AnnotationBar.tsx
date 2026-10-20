'use client'
import { useEffect, useRef, useState } from 'react'
import { Quote, Trash2, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { pdfAnnotations } from '../client/annotations'
import { MAX_COMMENT } from '../limits'
import type { AnnotationColor, PdfAnnotation } from '../types'

/** Farben wie im Kalender */
export const ANNOTATION_COLORS: { id: AnnotationColor; label: string }[] = [
  { id: 1, label: 'Rot' },
  { id: 2, label: 'Orange' },
  { id: 3, label: 'Gelb' },
  { id: 4, label: 'Grün' },
  { id: 5, label: 'Türkis' },
  { id: 6, label: 'Lila' },
]

/** Angeklickte Markierung: Kommentar, Farbe, als Zitat einfügen, löschen */
export default function AnnotationBar({
  annotation,
  focusComment,
  onInsert,
  onColor,
  onDelete,
  onClose,
}: {
  annotation: PdfAnnotation
  focusComment: boolean
  onInsert: () => void
  /** Gewählte Farbe auch für neue Markierungen übernehmen */
  onColor: (color: AnnotationColor) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [comment, setComment] = useState(annotation.comment)
  const latest = useRef({ annotation, comment, deleted: false })
  useEffect(() => {
    latest.current.annotation = annotation
    latest.current.comment = comment
  })

  const save = (patch: Partial<Pick<PdfAnnotation, 'comment' | 'color'>>) =>
    pdfAnnotations.save({ ...latest.current.annotation, ...patch, updatedAt: Date.now() })

  // Kommentar speichern, sobald eine Weile nicht getippt wird – und spätestens beim Schließen
  useEffect(() => {
    if (comment.trim() === annotation.comment) return
    const timer = setTimeout(() => save({ comment: comment.trim() }), 600)
    return () => clearTimeout(timer)
    // save liest nur latest – nicht neu planen, wenn sich die Markierung durch das Speichern selbst ändert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comment])
  useEffect(
    () => () => {
      const { annotation: a, comment: c, deleted } = latest.current
      if (!deleted && c.trim() !== a.comment) pdfAnnotations.save({ ...a, comment: c.trim(), updatedAt: Date.now() })
    },
    [],
  )

  return (
    <div
      className="space-y-1.5 border-t border-border bg-bg px-2 py-1.5"
      data-testid="pdf-annotation"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1.5 px-1" role="radiogroup" aria-label="Farbe">
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={annotation.color === c.id}
              aria-label={c.label}
              title={c.label}
              onClick={() => {
                save({ color: c.id })
                onColor(c.id)
              }}
              className={cn(
                'size-5 rounded-full ring-offset-2 ring-offset-bg transition',
                annotation.color === c.id ? 'ring-2 ring-fg' : 'hover:scale-110',
              )}
              style={{ background: `var(--swatch-${c.id})` }}
            />
          ))}
        </div>
        <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted" title={annotation.quote}>
          S. {annotation.page} · „{annotation.quote}“
        </span>
        <Button size="sm" variant="ghost" onClick={onInsert} title="Als Zitat mit Seitenlink in die Notiz einfügen">
          <Quote className="size-4" /> <span className="@max-lg:hidden">Als Zitat einfügen</span>
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => {
            latest.current.deleted = true
            onDelete()
          }}
          aria-label="Markierung löschen"
          title="Löschen"
        >
          <Trash2 className="size-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Markierung schließen" title="Schließen">
          <X className="size-4" />
        </Button>
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onClose()
        }}
        autoFocus={focusComment}
        maxLength={MAX_COMMENT}
        rows={2}
        placeholder="Kommentar …"
        aria-label="Kommentar"
        className="block max-h-40 min-h-14 w-full resize-y rounded-md border border-border bg-elevated px-2 py-1.5 text-sm text-fg outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
    </div>
  )
}
