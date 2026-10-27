'use client'
// Titel und Tags für eine Notiz von Claude vorschlagen lassen – übernommen wird nur, was angehakt ist
import { useEffect, useState } from 'react'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Spinner } from '@/shared/ui/spinner'
import { ErrorText } from '@/shared/ui/toast'
import { errorMessage } from '@/shared/client/api'
import { validateName } from '@/shared/lib/names'
import { suggestMeta } from '../client/ai'
import type { MetaSuggestion } from '../types'

export function AiMetaDialog({
  note,
  canTag,
  onApply,
  onClose,
}: {
  /** `content`: Text der Notiz (bei formatiertem Text ohne HTML) */
  note: { id: string; title: string; content: string }
  /** Tags lassen sich in diesem Format setzen (nicht im Canvas) */
  canTag: boolean
  onApply: (change: { title: string | null; tags: string[] }) => void
  onClose: () => void
}) {
  const [suggestion, setSuggestion] = useState<MetaSuggestion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [useTitle, setUseTitle] = useState(true)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<Set<string>>(new Set())
  // Stand beim Öffnen – spätere Änderungen an der Notiz lösen keine neue Anfrage aus
  const [input] = useState(note)

  useEffect(() => {
    const controller = new AbortController()
    suggestMeta({ noteId: input.id, title: input.title, content: input.content }, controller.signal)
      .then((s) => {
        setSuggestion(s)
        setTitle(s.title ?? input.title)
        setUseTitle(!!s.title && s.title !== input.title)
        setTags(new Set(s.tags))
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err))
      })
    // Geschlossen: Claude nicht umsonst weiterschreiben lassen
    return () => controller.abort()
  }, [input])

  const titleError = useTitle ? validateName(title) : null
  const chosenTags = canTag ? [...tags] : []
  const changes = (useTitle && title.trim() !== note.title) || chosenTags.length > 0

  return (
    <Modal
      open
      onClose={onClose}
      title="Titel und Tags vorschlagen"
      description={`„${note.title}“`}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            disabled={!suggestion || !changes || !!titleError}
            onClick={() => {
              onApply({ title: useTitle && title.trim() !== note.title ? title.trim() : null, tags: chosenTags })
              onClose()
            }}
          >
            Übernehmen
          </Button>
        </>
      }
    >
      {error ? (
        <ErrorText>{error}</ErrorText>
      ) : !suggestion ? (
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner className="size-4" /> Claude liest die Notiz …
        </p>
      ) : (
        <div className="space-y-5" data-testid="ai-meta">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={useTitle}
                onChange={(e) => setUseTitle(e.target.checked)}
                className="size-4 accent-[var(--accent)]"
              />
              Titel ändern
            </label>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setUseTitle(true)
              }}
              aria-label="Neuer Titel"
              aria-invalid={!!titleError}
            />
            {titleError ? <p className="text-sm text-danger">{titleError}</p> : null}
          </div>
          {canTag ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Neue Tags</legend>
              {suggestion.tags.length ? (
                <div className="flex flex-wrap gap-2">
                  {suggestion.tags.map((t) => (
                    <label key={t} className="flex cursor-pointer items-center gap-1.5 rounded-full bg-subtle px-3 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={tags.has(t)}
                        onChange={(e) => {
                          const next = new Set(tags)
                          if (e.target.checked) next.add(t)
                          else next.delete(t)
                          setTags(next)
                        }}
                        className="size-3.5 accent-[var(--accent)]"
                      />
                      #{t}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">Claude hat keine neuen Tags gefunden, die passen.</p>
              )}
            </fieldset>
          ) : null}
        </div>
      )}
    </Modal>
  )
}
