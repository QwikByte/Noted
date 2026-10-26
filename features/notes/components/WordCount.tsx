'use client'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { noteStats, wordsIn } from '../note-stats'
import type { NoteFormat } from '../types'

const num = (n: number) => n.toLocaleString('de-DE')

/** Wörter der Markierung im Editor – null ohne Markierung */
function useSelectedWords(format: NoteFormat, selectedText: (() => string) | null): number | null {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    if (!selectedText) return
    let frame = 0
    // Beim Ziehen mit der Maus kommen viele Ereignisse – einmal pro Bild genügt, und erst nachdem der Fokus gewechselt hat
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const text = selectedText()
        setCount(text.trim() ? wordsIn(format, text) : null)
      })
    }
    document.addEventListener('selectionchange', update)
    document.addEventListener('focusin', update)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('focusin', update)
    }
  }, [format, selectedText])
  return selectedText ? count : null
}

/**
 * Laufende Wortzahl mit Lesezeit in der Kopfzeile. Rechnet aus dem verzögerten Stand, damit das Tippen auch in langen
 * Notizen flüssig bleibt. Bewusst keine Live-Region – sonst würde jede Änderung angesagt
 */
export function WordCount({
  format,
  content,
  selectedText,
}: {
  format: NoteFormat
  content: string
  /** Markierter Text im Editor; null, wenn es keinen Editor mit Markierung gibt (Lesemodus, Mindmap, Canvas) */
  selectedText: (() => string) | null
}) {
  const deferredFormat = useDeferredValue(format)
  const deferredContent = useDeferredValue(content)
  const stats = useMemo(() => noteStats(deferredFormat, deferredContent), [deferredFormat, deferredContent])
  const selected = useSelectedWords(format, selectedText)
  return (
    <span className="mx-1 text-xs whitespace-nowrap text-faint tabular-nums" data-testid="word-count">
      {selected !== null
        ? `${num(selected)} von ${num(stats.words)} ${stats.words === 1 ? 'Wort' : 'Wörtern'}`
        : `${num(stats.words)} ${stats.words === 1 ? 'Wort' : 'Wörter'}`}
      {/* Auf schmalen Flächen nur die Wortzahl */}
      {stats.readingMinutes !== null ? (
        <span className="@max-3xl:hidden"> · ca. {stats.readingMinutes} Min. Lesezeit</span>
      ) : null}
    </span>
  )
}
