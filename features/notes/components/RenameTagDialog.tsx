'use client'
// Tag in allen Notizen umbenennen – gibt es den neuen Namen schon, werden beide Tags zusammengeführt
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApp } from '@/features/workspace/client/context'
import { graphKey } from '@/features/graph/client/queries'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Field, Input } from '@/shared/ui/input'
import { useToast } from '@/shared/ui/toast'
import { api, errorMessage } from '@/shared/client/api'
import { normalizeTag, trimTag } from '@/shared/markdown/meta'
import { keys, useNotes, useTags } from '../client/queries'
import { sync } from '../client/sync'

const INVALID = 'Ein Tag besteht aus Buchstaben, Ziffern, „-“, „_“ und „/“ – und nicht nur aus Ziffern.'

export function RenameTagDialog({ tag, onClose }: { tag: string; onClose: () => void }) {
  const app = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const { notes } = useNotes()
  const { data: tags = [] } = useTags()
  const [value, setValue] = useState(tag)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const target = normalizeTag(value)
  const existing = target && target !== tag ? tags.find((t) => t.tag === target) : undefined
  // Tresor-Notizen liest nur der Browser – der Server kann sie nicht ändern
  const hasTag = (t: string) => t === tag || t.startsWith(tag + '/')
  const inVault = notes.filter((n) => n.vault && n.tags.some(hasTag)).length

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!target) return setError(INVALID)
    setLoading(true)
    try {
      // Offene Änderungen zuerst senden – sonst überschriebe der Entwurf den umbenannten Tag wieder
      await Promise.all(sync.getDrafts().map((d) => sync.flush(d.id)))
      if (sync.getDrafts().some((d) => !d.vault)) {
        throw new Error('Es gibt noch nicht gespeicherte Änderungen. Warte, bis alles gespeichert ist, und versuche es dann erneut.')
      }
      const res = await api<{ notes: number }>('/api/tags/rename', { method: 'POST', body: { from: tag, to: value } })
      await Promise.all([keys.notes, keys.tags, ['note'], graphKey].map((queryKey) => qc.invalidateQueries({ queryKey })))
      const name = trimTag(value)
      const count = `${res.notes} ${res.notes === 1 ? 'Notiz' : 'Notizen'}`
      const vaultHint = inVault ? ` ${inVault} ${inVault === 1 ? 'Notiz' : 'Notizen'} im Tresor bitte selbst anpassen.` : ''
      toast.success(`#${tag} in ${count} ${existing ? `mit #${target} zusammengeführt` : `in #${name} umbenannt`}.${vaultHint}`)
      if (app.view.kind === 'tag' && app.view.tag === tag) app.go({ kind: 'tag', tag: target }, { replace: true })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`#${tag} umbenennen`}
      description="Ändert den Tag in allen deinen Notizen, auch Unter-Tags wie #thema/teil – im Text und in den Properties."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="rename-tag-form" loading={loading} disabled={!target || target === tag}>
            {existing ? 'Zusammenführen' : 'Umbenennen'}
          </Button>
        </>
      }
    >
      <form id="rename-tag-form" onSubmit={submit} className="space-y-3">
        <Field
          label="Neuer Name"
          error={error ?? (value.trim() && !target ? INVALID : null)}
          hint={
            existing
              ? `#${existing.tag} gibt es schon (${existing.count} ${existing.count === 1 ? 'Notiz' : 'Notizen'}) – beide Tags werden zusammengeführt.`
              : undefined
          }
        >
          {(id) => (
            <Input
              id={id}
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setError(null)
              }}
              autoFocus
              autoCapitalize="off"
              spellCheck={false}
            />
          )}
        </Field>
        {inVault ? (
          <p className="text-xs text-muted">
            {inVault} {inVault === 1 ? 'Notiz' : 'Notizen'} im Tresor {inVault === 1 ? 'bleibt' : 'bleiben'} unverändert – Notizen
            im Tresor kann nur dein Browser lesen.
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
