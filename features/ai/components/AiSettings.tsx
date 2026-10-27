'use client'
// Einstellungen → KI: eigenen Anthropic-API-Schlüssel hinterlegen, Modell wählen, Schlüssel entfernen
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, Trash2 } from 'lucide-react'
import { Section } from '@/shared/ui/sub-page'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Field, Input, Select } from '@/shared/ui/input'
import { ConfirmModal } from '@/shared/ui/modal'
import { ErrorText, useToast } from '@/shared/ui/toast'
import { errorMessage } from '@/shared/client/api'
import { removeAiKey, saveAiSettings, useAiSettings } from '../client/ai'
import { AI_MODELS, DEFAULT_MODEL, type AiModel } from '../models'

const CONSOLE_KEYS = 'https://platform.claude.com/settings/keys'

function ModelSelect({ value, onChange, disabled }: { value: AiModel; onChange: (m: AiModel) => void; disabled?: boolean }) {
  return (
    <Field label="Modell" hint={AI_MODELS.find((m) => m.id === value)?.description} className="max-w-sm">
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value as AiModel)} disabled={disabled}>
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )
}

export function AiSettings() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: settings, isLoading } = useAiSettings()
  const [editing, setEditing] = useState(false)
  const [apiKey, setApiKey] = useState('')
  // null: das gespeicherte Modell
  const [model, setModel] = useState<AiModel | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)
  const current = model ?? settings?.model ?? DEFAULT_MODEL

  function closeForm() {
    setEditing(false)
    setApiKey('')
    setModel(null)
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await saveAiSettings(qc, { apiKey: apiKey.trim(), model: current })
      toast.success('Schlüssel gespeichert – Claude ist bereit.')
      closeForm()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  // Bei hinterlegtem Schlüssel gilt ein anderes Modell sofort – der Server prüft, ob der Schlüssel es nutzen darf
  async function changeModel(next: AiModel) {
    setModel(next)
    setSaving(true)
    try {
      await saveAiSettings(qc, { model: next })
      toast.success('Modell gespeichert.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setModel(null)
      setSaving(false)
    }
  }

  return (
    <Section
      id="ki"
      title="KI (Claude)"
      description="Claude von Anthropic schlägt dir Karteikarten aus deinen Notizen vor. Dafür hinterlegst du einen eigenen API-Schlüssel – die Kosten rechnet Anthropic direkt mit dir ab."
    >
      {isLoading ? null : !settings ? (
        <p className="text-sm text-muted">Die Einstellungen konnten nicht geladen werden.</p>
      ) : settings.configured && !editing ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="success">Aktiv</Badge>
            <span className="text-sm text-muted">
              Schlüssel <span className="font-mono">{settings.keyHint}</span>
            </span>
          </div>
          <ModelSelect value={current} onChange={(m) => void changeModel(m)} disabled={saving} />
          <div className="flex flex-wrap gap-2 border-t border-border pt-5">
            <Button onClick={() => setEditing(true)}>
              <KeyRound className="size-4" /> Schlüssel ändern …
            </Button>
            <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
              <Trash2 className="size-4" /> Schlüssel entfernen
            </Button>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <ErrorText>{error}</ErrorText>
          <Field
            label="API-Schlüssel"
            className="max-w-sm"
            hint={
              <>
                Erstellen kannst du ihn in der{' '}
                <a href={CONSOLE_KEYS} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
                  Claude Console
                </a>{' '}
                unter „API keys“. Wähle dabei einen Workspace aus.
              </>
            }
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-…"
                autoComplete="off"
                spellCheck={false}
                required
                className="font-mono"
              />
            )}
          </Field>
          <ModelSelect value={current} onChange={setModel} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={saving} disabled={!apiKey.trim()}>
              Prüfen und speichern
            </Button>
            {editing ? <Button onClick={closeForm}>Abbrechen</Button> : null}
          </div>
        </form>
      )}
      <p className="mt-5 text-xs text-muted">
        Nur wenn du eine KI-Aktion startest, geht ihr Inhalt an Anthropic – der Text der Notiz bzw. die PDF-Seiten oder
        Markierungen als Text und Bild. Notizen aus dem Tresor nie. Der Schlüssel liegt verschlüsselt auf diesem Server
        und wird nicht wieder angezeigt.
      </p>
      <ConfirmModal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="Schlüssel entfernen?"
        description="Danach schlägt Claude keine Karten mehr vor, bis du wieder einen Schlüssel hinterlegst. Bei Anthropic bleibt der Schlüssel gültig – löschen kannst du ihn in der Claude Console."
        confirmLabel="Entfernen"
        danger
        loading={removing}
        onConfirm={async () => {
          setRemoving(true)
          try {
            await removeAiKey(qc)
            setConfirmRemove(false)
            toast.success('Schlüssel entfernt.')
          } catch (err) {
            toast.error(errorMessage(err))
          } finally {
            setRemoving(false)
          }
        }}
      />
    </Section>
  )
}
