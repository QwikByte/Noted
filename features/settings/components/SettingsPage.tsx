'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  KeyRound,
  Laptop,
  LogOut,
  Monitor,
  Palette,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Upload,
  User,
} from 'lucide-react'
import { useUser } from '@/features/auth/client/current-user'
import { confirmLogout } from '@/features/auth/client/logout'
import { ThemeSwitch } from '@/shared/ui/theme-switch'
import { PasswordChangeForm } from '@/features/auth/components/PasswordChangeForm'
import { MfaSetup } from '@/features/auth/components/MfaSetup'
import { CalendarSettings } from '@/features/calendar/components/CalendarSettings'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Field, Input, Select, Switch } from '@/shared/ui/input'
import { Modal } from '@/shared/ui/modal'
import { ErrorText, useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { Section, SubPageHeader } from '@/shared/ui/sub-page'
import { api, errorMessage } from '@/shared/client/api'
import { describeUserAgent, formatDateTime, formatRelative } from '@/shared/lib/format'
import { keys, useDrafts, useFolders } from '@/features/notes/client/queries'
import { attachmentsKey } from '@/features/attachments/client/queries'
import { sync } from '@/features/notes/client/sync'
import { useFontSize, usePref, type EditorMode } from '@/shared/client/prefs'
import type { SessionInfo } from '@/features/auth/types'

export function SettingsPage() {
  const user = useUser()
  return (
    <div className="min-h-dvh bg-subtle">
      <SubPageHeader title="Einstellungen" />
      <main className="mx-auto max-w-3xl space-y-5 px-3 py-6 pb-24 sm:px-6">
        <ProfileSection />
        <Section icon={<KeyRound />} title="Passwort" description="Nach der Änderung werden alle anderen Geräte abgemeldet.">
          <PasswordForm />
        </Section>
        <MfaSection />
        <SessionsSection />
        <AppearanceSection />
        <CalendarSettings />
        <DataSection />
        <Section icon={<LogOut />} title="Abmelden" description={`Angemeldet als @${user.username}.`}>
          <Button onClick={confirmLogout}>
            <LogOut className="size-4" /> Abmelden
          </Button>
        </Section>
      </main>
    </div>
  )
}

function ProfileSection() {
  const user = useUser()
  const toast = useToast()
  const router = useRouter()
  const [name, setName] = useState(user.displayName)
  const [loading, setLoading] = useState(false)
  return (
    <Section icon={<User />} title="Profil">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setLoading(true)
          try {
            await api('/api/account/profile', { method: 'PATCH', body: { displayName: name } })
            toast.success('Profil gespeichert.')
            router.refresh()
          } catch (err) {
            toast.error(errorMessage(err))
          } finally {
            setLoading(false)
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Anzeigename">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}</Field>
          <Field label="Benutzername" hint="Kann nur vom Administrator geändert werden.">
            {(id) => <Input id={id} value={user.username} disabled />}
          </Field>
        </div>
        <Button type="submit" variant="primary" loading={loading} disabled={name === user.displayName}>
          Speichern
        </Button>
      </form>
    </Section>
  )
}

function PasswordForm() {
  const toast = useToast()
  const [key, setKey] = useState(0)
  return <PasswordChangeForm key={key} onDone={() => (toast.success('Passwort geändert.'), setKey((k) => k + 1))} />
}

function MfaSection() {
  const user = useUser()
  const toast = useToast()
  const [enabled, setEnabled] = useState(user.mfaEnabled)
  const [setupOpen, setSetupOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)

  return (
    <Section
      icon={<ShieldCheck />}
      title="Zwei-Faktor-Anmeldung"
      description="Zusätzlich zum Passwort wird bei der Anmeldung ein Code aus einer Authenticator-App abgefragt."
    >
      <div className="flex flex-wrap items-center gap-3">
        {enabled ? <Badge tone="success">Aktiv</Badge> : <Badge tone="warning">Nicht eingerichtet</Badge>}
        {user.mfaRequired ? <Badge tone="accent">Vom Administrator vorgeschrieben</Badge> : null}
      </div>
      <div className="mt-4">
        {!enabled ? (
          setupOpen ? (
            <MfaSetup
              onDone={() => {
                setEnabled(true)
                setSetupOpen(false)
                toast.success('Zwei-Faktor-Anmeldung aktiviert. Andere Geräte wurden abgemeldet.')
              }}
              onCancel={() => setSetupOpen(false)}
            />
          ) : (
            <Button variant="primary" onClick={() => setSetupOpen(true)}>
              <ShieldCheck className="size-4" /> Einrichten
            </Button>
          )
        ) : user.mfaRequired ? (
          <p className="text-sm text-muted">
            Bei einem neuen Handy: Der Administrator kann die Zwei-Faktor-Anmeldung zurücksetzen, danach richtest du sie neu ein.
          </p>
        ) : (
          <Button onClick={() => setDisableOpen(true)}>
            <ShieldOff className="size-4" /> Deaktivieren
          </Button>
        )}
      </div>
      <DisableMfaDialog
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        onDone={() => {
          setEnabled(false)
          setDisableOpen(false)
          toast.success('Zwei-Faktor-Anmeldung deaktiviert.')
        }}
      />
    </Section>
  )
}

function DisableMfaDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Zwei-Faktor-Anmeldung deaktivieren"
      description="Bestätige mit deinem Passwort und einem aktuellen Code."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="danger" type="submit" form="disable-mfa" loading={loading}>
            Deaktivieren
          </Button>
        </>
      }
    >
      <form
        id="disable-mfa"
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setError(null)
          setLoading(true)
          try {
            await api('/api/account/mfa/disable', { method: 'POST', body: { password, code } })
            setPassword('')
            setCode('')
            onDone()
          } catch (err) {
            setError(errorMessage(err))
          } finally {
            setLoading(false)
          }
        }}
      >
        <ErrorText>{error}</ErrorText>
        <Field label="Passwort">
          {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />}
        </Field>
        <Field label="Code aus der App">
          {(id) => (
            <Input
              id={id}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, '').slice(0, 7))}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="font-mono tracking-widest"
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}

function SessionsSection() {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<{ sessions: SessionInfo[] }>('/api/account/sessions').then((r) => r.sessions),
  })
  const others = sessions.filter((s) => !s.current)

  async function revoke(id?: string) {
    try {
      await api(id ? `/api/account/sessions/${id}` : '/api/account/sessions', { method: 'DELETE' })
      await qc.invalidateQueries({ queryKey: ['sessions'] })
      toast.success(id ? 'Gerät abgemeldet.' : 'Alle anderen Geräte wurden abgemeldet.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Section icon={<Laptop />} title="Angemeldete Geräte" description="Sitzungen laufen nach 30 Tagen ohne Nutzung ab.">
      {isLoading ? (
        <p className="text-sm text-muted">Lädt …</p>
      ) : (
        <ul className="divide-y divide-border">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3 first:pt-0">
              <Monitor className="size-5 shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {describeUserAgent(s.userAgent)}
                  {s.current ? <Badge tone="success">Dieses Gerät</Badge> : null}
                </p>
                <p className="text-xs text-faint">
                  {s.ip ?? 'IP unbekannt'} · aktiv {formatRelative(s.lastSeenAt)} · angemeldet {formatDateTime(s.createdAt)}
                </p>
              </div>
              {!s.current ? (
                <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>
                  Abmelden
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 ? (
        <Button className="mt-3" onClick={() => revoke()}>
          Alle anderen Geräte abmelden
        </Button>
      ) : null}
    </Section>
  )
}

function AppearanceSection() {
  const [fontSize, setFontSize] = useFontSize()
  const [mode, setMode] = usePref<EditorMode>('noted:mode', 'edit')
  const [spellcheck, setSpellcheck] = usePref<'1' | '0'>('noted:spellcheck', '1')
  return (
    <Section icon={<Palette />} title="Darstellung" description="Gilt nur für dieses Gerät.">
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium">Design</p>
          <div className="max-w-sm">
            <ThemeSwitch />
          </div>
        </div>
        <div>
          <label htmlFor="font-size" className="mb-2 flex items-center justify-between text-sm font-medium">
            Schriftgröße im Editor <span className="text-muted">{fontSize}px</span>
          </label>
          <input
            id="font-size"
            type="range"
            min={13}
            max={22}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-full max-w-sm accent-[var(--accent)]"
          />
        </div>
        <div className="max-w-sm">
          <Switch
            checked={spellcheck === '1'}
            onChange={(v) => setSpellcheck(v ? '1' : '0')}
            label="Rechtschreibprüfung im Editor"
            description="Auf dem Handy auch Autokorrektur. Wirkt beim nächsten Öffnen einer Notiz."
          />
        </div>
        <Field label="Notizen öffnen im Modus" className="max-w-sm">
          {(id) => (
            <Select id={id} value={mode} onChange={(e) => setMode(e.target.value as EditorMode)}>
              <option value="edit">Bearbeiten</option>
              <option value="read">Lesen</option>
              <option value="split">Geteilt (nur große Bildschirme)</option>
            </Select>
          )}
        </Field>
      </div>
    </Section>
  )
}

function DataSection() {
  const toast = useToast()
  const qc = useQueryClient()
  const drafts = useDrafts()
  const { data: folders = [] } = useFolders()
  const input = useRef<HTMLInputElement>(null)
  const [targetFolder, setTargetFolder] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ notes: number; attachments: number; folders: number; skipped: string[] } | null>(null)

  async function runImport(files: File[]) {
    setImporting(true)
    setResult(null)
    try {
      const form = new FormData()
      for (const f of files) form.append('files', f)
      if (targetFolder) form.append('folderId', targetFolder)
      const res = await api<NonNullable<typeof result>>('/api/import', { method: 'POST', form })
      setResult(res)
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.notes }),
        qc.invalidateQueries({ queryKey: keys.folders }),
        qc.invalidateQueries({ queryKey: keys.tags }),
        qc.invalidateQueries({ queryKey: attachmentsKey }),
      ])
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setImporting(false)
    }
  }

  return (
    <Section
      icon={<Download />}
      title="Export & Import"
      description="Deine Notizen sind normale Markdown-Dateien – kompatibel mit Obsidian."
    >
      <div className="space-y-6">
        <div>
          <p className="mb-1 text-sm font-medium">Alles exportieren</p>
          <p className="mb-3 text-sm text-muted">
            ZIP-Archiv mit allen Notizen in ihrer Ordnerstruktur und allen Anhängen. Entpacken und in Obsidian als Vault öffnen –
            oder in einen bestehenden Vault kopieren. Notizen mit formatiertem Text liegen als .html-Dateien darin, Canvas als
            .canvas-Dateien wie in Obsidian.
          </p>
          <a
            href="/api/export"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent shadow-sm hover:bg-accent-hover"
          >
            <Download className="size-4" /> ZIP herunterladen
          </a>
        </div>
        <div className="border-t border-border pt-5">
          <p className="mb-1 text-sm font-medium">Importieren</p>
          <p className="mb-3 text-sm text-muted">
            Markdown-Dateien (.md, Mindmaps des Plugins „Enhancing Mindmap“ werden erkannt), HTML-Dateien (werden zu
            formatiertem Text), Canvas-Dateien (.canvas), ein ZIP-Archiv (z. B. ein Obsidian-Vault oder ein Export aus Noted)
            oder beliebige Dateien als Anhänge.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Zielordner" className="min-w-56 flex-1">
              {(id) => (
                <Select id={id} value={targetFolder} onChange={(e) => setTargetFolder(e.target.value)}>
                  <option value="">— Oberste Ebene —</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button onClick={() => input.current?.click()} loading={importing}>
              <Upload className="size-4" /> Dateien wählen
            </Button>
          </div>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (files.length) void runImport(files)
            }}
          />
          {result ? (
            <div className="mt-4 rounded-xl bg-success-soft px-4 py-3 text-sm text-success">
              Importiert: {result.notes} Notizen, {result.folders} Ordner, {result.attachments} Anhänge.
              {result.skipped.length > 0 ? (
                <details className="mt-2 text-muted">
                  <summary className="cursor-pointer">{result.skipped.length} übersprungen</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {result.skipped.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="border-t border-border pt-5">
          <p className="mb-1 text-sm font-medium">Lokale Sicherung</p>
          <p className={cn('mb-3 text-sm', drafts.length ? 'text-warning' : 'text-muted')}>
            {drafts.length
              ? `${drafts.length} ${drafts.length === 1 ? 'Änderung ist' : 'Änderungen sind'} nur auf diesem Gerät gespeichert und werden synchronisiert, sobald eine Verbindung besteht.`
              : 'Alle Änderungen sind mit dem Server synchronisiert.'}
          </p>
          {drafts.length ? (
            <Button onClick={() => sync.flushAll()}>
              <RefreshCw className="size-4" /> Jetzt synchronisieren
            </Button>
          ) : null}
        </div>
      </div>
    </Section>
  )
}
