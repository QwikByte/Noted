'use client'
// Urteil von Claude über eine Antwort – beim Lernen, beim Tutor und in der Probeklausur
import { AlertCircle, CheckCircle2, Loader2, Sparkles, XCircle } from 'lucide-react'
import { CardMarkdown } from '@/features/flashcards/components/CardMarkdown'
import { cn } from '@/shared/ui/cn'
import { VERDICT_LABELS } from '../grade'
import type { GradeResult, GradeVerdict } from '../types'

/** Stand einer Bewertung: läuft, fertig oder gescheitert (mit Meldung) */
export type GradeCheck = { status: 'running' } | { status: 'done'; result: GradeResult } | { status: 'error'; message: string }

const VERDICT_STYLES: Record<GradeVerdict, string> = { correct: 'text-success', partial: 'text-warning', wrong: 'text-danger' }

const VERDICT_ICONS = { correct: CheckCircle2, partial: AlertCircle, wrong: XCircle }

/** `max`: erreichbare Punkte – dann stehen die erreichten neben dem Urteil */
export function AiGradeNote({ check, max, className }: { check: GradeCheck; max?: number; className?: string }) {
  if (check.status === 'running') {
    return (
      <p className={cn('flex items-center gap-2 text-sm text-muted', className)} data-testid="ai-grade-running">
        <Loader2 className="size-4 animate-spin" /> Claude prüft deine Antwort …
      </p>
    )
  }
  if (check.status === 'error') {
    return <p className={cn('text-sm text-muted', className)}>Claude konnte die Antwort nicht prüfen: {check.message}</p>
  }
  const { verdict, feedback, points } = check.result
  const Icon = VERDICT_ICONS[verdict]
  return (
    <div className={cn('rounded-xl border border-border bg-subtle/50 px-3.5 py-3', className)} data-testid="ai-verdict">
      <p className={cn('mb-1 flex items-center gap-2 text-sm font-semibold', VERDICT_STYLES[verdict])}>
        <Icon className="size-4" /> {VERDICT_LABELS[verdict]}
        {max ? (
          <span className="font-normal text-muted tabular-nums">
            · {points.toLocaleString('de-DE')} von {max} {max === 1 ? 'Punkt' : 'Punkten'}
          </span>
        ) : null}
        <Sparkles className="ml-auto size-3.5 text-faint" aria-label="Bewertet von Claude" />
      </p>
      {feedback ? <CardMarkdown text={feedback} className="text-sm" /> : null}
    </div>
  )
}
