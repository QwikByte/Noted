'use client'
// Mehrzeiliges Antwortfeld für Tutor und Probeklausur – Strg/⌘+Enter schickt ab
import { forwardRef } from 'react'
import { cn } from '@/shared/ui/cn'
import { MAX_AI_ANSWER_CHARS } from '../limits'

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onSubmit'> & { onSubmit?: () => void }

export const AnswerField = forwardRef<HTMLTextAreaElement, Props>(function AnswerField({ onSubmit, className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      maxLength={MAX_AI_ANSWER_CHARS}
      rows={4}
      onKeyDown={(e) => {
        if (onSubmit && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onSubmit()
        }
      }}
      className={cn(
        'block min-h-24 w-full resize-y rounded-lg border border-border-strong/70 bg-elevated px-3.5 py-2.5 text-[15px] text-fg outline-none',
        'placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent/20 disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
})
