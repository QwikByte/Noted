'use client'
import { useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Copy,
  KeyRound,
  Lock,
  LogOut,
  MoreHorizontal,
  Pencil,
  Power,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Unlock,
  UserPlus,
  Users,
} from 'lucide-react'
import { useUser } from '../app/AppProviders'
import { Avatar } from '../app/UserMenu'
import { Section, SubPageHeader } from '../settings/SettingsPage'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Field, Input, Select, Switch } from '../ui/input'
import { ConfirmModal, Modal } from '../ui/modal'
import { Menu, MenuItem, MenuSeparator } from '../ui/menu'
import { ErrorText, useToast } from '../ui/toast'
import { cn } from '../ui/cn'
import { api, errorMessage } from '@/lib/client/api'
import { copyText } from '@/lib/client/clipboard'
import { formatDateTime, formatRelative } from '@/lib/client/format'
import type { AdminUser, Role } from '@/lib/shared/types'

type Tab = 'users' | 'security' | 'audit'

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('users')
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'users', label: 'Benutzer', icon: <Users className="size-4" /> },
    { id: 'security', label: 'Sicherheit', icon: <ShieldCheck className="size-4" /> },
    { id: 'audit', label: 'Protokoll', icon: <ScrollText className="size-4" /> },
  ]
  return (
    <div className="min-h-dvh bg-subtle">
      <SubPageHeader title="Administration" />
      <main className="mx-auto max-w-3xl px-3 py-6 pb-24 sm:px-6">
        <div className="mb-5 flex gap-1 rounded-xl bg-elevated p-1 shadow-sm" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                tab === t.id ? 'bg-accent text-white shadow-sm' : 'text-muted hover:bg-hover hover:text-fg',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'users' ? <UsersTab /> : tab === 'security' ? <SecurityTab /> : <AuditTab />}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Benutzer
// ---------------------------------------------------------------------------

function useUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api<{ users: AdminUser[] }>('/api/admin/users').then((r) => r.users),
  })
}

type Credentials = { username: string; password: string; title: string }

function UsersTab() {
  const me = useUser()
  const qc = useQueryClient()
  const toast = useToast()
  const { data: users = [], isLoading } = useUsers()
  const [createOpen, setCreateOpen] = useState(false)
  const [edit, setEdit] = useState<AdminUser | null>(null)
  const [resetPw, setResetPw] = useState<AdminUser | null>(null)
  const [confirm, setConfirm] = useState<{ user: AdminUser; action: 'mfa' | 'sessions' } | null>(null)
  const [del, setDel] = useState<AdminUser | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] })

  async function patch(user: AdminUser, body: Record<string, unknown>, success: string) {
    try {
      await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body })
      await refresh()
      toast.success(success)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {users.length} {users.length === 1 ? 'Konto' : 'Konten'} · Neue Konten können nur hier angelegt werden.
        </p>
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          <UserPlus className="size-4" /> Benutzer anlegen
        </Button>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted">Lädt …</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-elevated">
          {users.map((u) => {
            const isMe = u.id === me.id
            return (
              <li key={u.id} className="flex items-start gap-3 px-4 py-3.5" data-testid={`user-${u.username}`}>
                <Avatar name={u.displayName} className={cn('mt-0.5', !u.isActive && 'opacity-50')} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={cn('font-medium', !u.isActive && 'text-muted line-through')}>{u.displayName}</span>
                    <span className="text-sm text-faint">@{u.username}</span>
                    {isMe ? <Badge>Du</Badge> : null}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {u.role === 'admin' ? <Badge tone="accent">Admin</Badge> : null}
                    {!u.isActive ? <Badge tone="danger">Deaktiviert</Badge> : null}
                    {u.lockedUntil ? (
                      <Badge tone="danger">
                        <Lock className="size-3" /> Gesperrt
                      </Badge>
                    ) : null}
                    {u.mfaEnabled ? (
                      <Badge tone="success">
                        <ShieldCheck className="size-3" /> MFA aktiv
                      </Badge>
                    ) : u.mfaRequired ? (
                      <Badge tone="warning">MFA ausstehend</Badge>
                    ) : (
                      <Badge>
                        <ShieldOff className="size-3" /> Ohne MFA
                      </Badge>
                    )}
                    {u.mustChangePassword ? <Badge tone="warning">Startpasswort</Badge> : null}
                  </div>
                  <p className="mt-1.5 text-xs text-faint">
                    {u.noteCount} {u.noteCount === 1 ? 'Notiz' : 'Notizen'} · zuletzt angemeldet{' '}
                    {u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'nie'}
                  </p>
                </div>
                <Menu
                  trigger={(p) => (
                    <Button variant="ghost" size="icon-sm" aria-label={`Aktionen für ${u.username}`} {...p}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  )}
                >
                  <MenuItem icon={<Pencil />} onSelect={() => setEdit(u)}>
                    Bearbeiten
                  </MenuItem>
                  <MenuItem icon={<KeyRound />} onSelect={() => setResetPw(u)}>
                    Passwort zurücksetzen
                  </MenuItem>
                  {u.mfaEnabled && !isMe ? (
                    <MenuItem icon={<ShieldOff />} onSelect={() => setConfirm({ user: u, action: 'mfa' })}>
                      MFA zurücksetzen
                    </MenuItem>
                  ) : null}
                  {u.lockedUntil ? (
                    <MenuItem icon={<Unlock />} onSelect={() => patch(u, { unlock: true }, 'Konto entsperrt.')}>
                      Entsperren
                    </MenuItem>
                  ) : null}
                  {!isMe ? (
                    <>
                      <MenuItem icon={<LogOut />} onSelect={() => setConfirm({ user: u, action: 'sessions' })}>
                        Alle Sitzungen beenden
                      </MenuItem>
                      <MenuItem
                        icon={<Power />}
                        onSelect={() =>
                          patch(u, { isActive: !u.isActive }, u.isActive ? 'Konto deaktiviert.' : 'Konto aktiviert.')
                        }
                      >
                        {u.isActive ? 'Deaktivieren' : 'Aktivieren'}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem icon={<Trash2 />} danger onSelect={() => setDel(u)}>
                        Löschen
                      </MenuItem>
                    </>
                  ) : null}
                </Menu>
              </li>
            )
          })}
        </ul>
      )}

      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(c) => {
          setCreateOpen(false)
          void refresh()
          if (c) setCredentials(c)
          else toast.success('Benutzer angelegt.')
        }}
      />
      <EditUserDialog user={edit} isMe={edit?.id === me.id} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), refresh())} />
      <ResetPasswordDialog
        user={resetPw}
        onClose={() => setResetPw(null)}
        onDone={(c) => {
          setResetPw(null)
          void refresh()
          if (c) setCredentials(c)
          else toast.success('Passwort zurückgesetzt.')
        }}
      />
      <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />
      <ConfirmModal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.action === 'mfa' ? 'MFA zurücksetzen?' : 'Alle Sitzungen beenden?'}
        description={
          confirm?.action === 'mfa'
            ? `@${confirm.user.username} kann sich danach ohne Code anmelden${confirm.user.mfaRequired ? ' und muss MFA neu einrichten' : ''}. Alle Sitzungen werden beendet.`
            : `@${confirm?.user.username} wird auf allen Geräten abgemeldet.`
        }
        confirmLabel={confirm?.action === 'mfa' ? 'Zurücksetzen' : 'Beenden'}
        danger
        loading={busy}
        onConfirm={async () => {
          if (!confirm) return
          setBusy(true)
          try {
            await api(`/api/admin/users/${confirm.user.id}/${confirm.action === 'mfa' ? 'mfa' : 'sessions'}`, { method: 'DELETE' })
            await refresh()
            toast.success(confirm.action === 'mfa' ? 'MFA zurückgesetzt.' : 'Sitzungen beendet.')
            setConfirm(null)
          } catch (err) {
            toast.error(errorMessage(err))
          } finally {
            setBusy(false)
          }
        }}
      />
      <DeleteUserDialog user={del} onClose={() => setDel(null)} onDeleted={() => (setDel(null), refresh(), toast.success('Benutzer gelöscht.'))} />
    </div>
  )
}

function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (credentials: Credentials | null) => void
}) {
  const empty = { username: '', displayName: '', role: 'user' as Role, password: '', generate: true, mfaRequired: false }
  const [form, setForm] = useState(empty)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setForm(empty)
      setError(null)
    }
  }
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Benutzer anlegen"
      description="Der neue Benutzer muss das Startpasswort bei der ersten Anmeldung ändern."
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="create-user" loading={loading}>
            Anlegen
          </Button>
        </>
      }
    >
      <form
        id="create-user"
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setError(null)
          setLoading(true)
          try {
            const res = await api<{ user: { username: string }; password: string | null }>('/api/admin/users', {
              method: 'POST',
              body: {
                username: form.username,
                displayName: form.displayName,
                role: form.role,
                mfaRequired: form.mfaRequired,
                password: form.generate ? undefined : form.password,
              },
            })
            onCreated(res.password ? { username: res.user.username, password: res.password, title: 'Benutzer angelegt' } : null)
          } catch (err) {
            setError(errorMessage(err))
          } finally {
            setLoading(false)
          }
        }}
      >
        <ErrorText>{error}</ErrorText>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Benutzername" hint="2–32 Zeichen: Buchstaben, Ziffern, . _ -">
            {(id) => (
              <Input
                id={id}
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                autoFocus
              />
            )}
          </Field>
          <Field label="Anzeigename">
            {(id) => <Input id={id} value={form.displayName} onChange={(e) => set('displayName', e.target.value)} placeholder="z. B. Lisa Müller" />}
          </Field>
        </div>
        <Field label="Rolle">
          {(id) => (
            <Select id={id} value={form.role} onChange={(e) => set('role', e.target.value as Role)}>
              <option value="user">Benutzer</option>
              <option value="admin">Administrator</option>
            </Select>
          )}
        </Field>
        <div className="space-y-3 rounded-xl border border-border p-4">
          <Switch
            checked={form.generate}
            onChange={(v) => set('generate', v)}
            label="Startpasswort generieren"
            description="Wird nach dem Anlegen einmalig angezeigt."
          />
          {!form.generate ? (
            <Field label="Startpasswort" hint="Mindestens 10 Zeichen.">
              {(id) => (
                <Input id={id} type="text" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="off" required minLength={10} />
              )}
            </Field>
          ) : null}
        </div>
        <div className="rounded-xl border border-border p-4">
          <Switch
            checked={form.mfaRequired}
            onChange={(v) => set('mfaRequired', v)}
            label="Zwei-Faktor-Anmeldung vorschreiben"
            description="Der Benutzer muss bei der ersten Anmeldung eine Authenticator-App einrichten."
          />
        </div>
      </form>
    </Modal>
  )
}

function EditUserDialog({
  user,
  isMe,
  onClose,
  onSaved,
}: {
  user: AdminUser | null
  isMe: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [form, setForm] = useState({ displayName: '', role: 'user' as Role, mfaRequired: false, isActive: true })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [prevUser, setPrevUser] = useState<AdminUser | null>(null)
  if (user !== prevUser) {
    setPrevUser(user)
    if (user) {
      setForm({ displayName: user.displayName === user.username ? '' : user.displayName, role: user.role, mfaRequired: user.mfaRequiredByAdmin, isActive: user.isActive })
      setError(null)
    }
  }

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={`@${user?.username ?? ''} bearbeiten`}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="edit-user" loading={loading}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        id="edit-user"
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!user) return
          setError(null)
          setLoading(true)
          try {
            await api(`/api/admin/users/${user.id}`, {
              method: 'PATCH',
              body: isMe ? { displayName: form.displayName, mfaRequired: form.mfaRequired } : form,
            })
            toast.success('Gespeichert.')
            onSaved()
          } catch (err) {
            setError(errorMessage(err))
          } finally {
            setLoading(false)
          }
        }}
      >
        <ErrorText>{error}</ErrorText>
        <Field label="Anzeigename">
          {(id) => <Input id={id} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />}
        </Field>
        <Field label="Rolle" hint={isMe ? 'Die eigene Rolle kann nicht geändert werden.' : undefined}>
          {(id) => (
            <Select id={id} value={form.role} disabled={isMe} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="user">Benutzer</option>
              <option value="admin">Administrator</option>
            </Select>
          )}
        </Field>
        <div className="space-y-4 rounded-xl border border-border p-4">
          <Switch
            checked={form.mfaRequired}
            onChange={(v) => setForm({ ...form, mfaRequired: v })}
            label="Zwei-Faktor-Anmeldung vorschreiben"
            description={user?.mfaEnabled ? 'Ist bereits eingerichtet.' : 'Muss beim nächsten Seitenaufruf eingerichtet werden.'}
          />
          {!isMe ? (
            <Switch
              checked={form.isActive}
              onChange={(v) => setForm({ ...form, isActive: v })}
              label="Konto aktiv"
              description="Deaktivierte Konten können sich nicht anmelden. Notizen bleiben erhalten."
            />
          ) : null}
        </div>
      </form>
    </Modal>
  )
}

function ResetPasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: AdminUser | null
  onClose: () => void
  onDone: (c: Credentials | null) => void
}) {
  const [generate, setGenerate] = useState(true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [prevUser, setPrevUser] = useState<AdminUser | null>(null)
  if (user !== prevUser) {
    setPrevUser(user)
    setGenerate(true)
    setPassword('')
    setError(null)
  }
  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title="Passwort zurücksetzen"
      description={`@${user?.username} muss danach ein neues Passwort festlegen und wird überall abgemeldet.`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="reset-pw" loading={loading}>
            Zurücksetzen
          </Button>
        </>
      }
    >
      <form
        id="reset-pw"
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!user) return
          setError(null)
          setLoading(true)
          try {
            const res = await api<{ password: string | null }>(`/api/admin/users/${user.id}/password`, {
              method: 'POST',
              body: { password: generate ? undefined : password },
            })
            onDone(res.password ? { username: user.username, password: res.password, title: 'Neues Startpasswort' } : null)
          } catch (err) {
            setError(errorMessage(err))
          } finally {
            setLoading(false)
          }
        }}
      >
        <ErrorText>{error}</ErrorText>
        <Switch checked={generate} onChange={setGenerate} label="Passwort generieren" />
        {!generate ? (
          <Field label="Neues Startpasswort" hint="Mindestens 10 Zeichen.">
            {(id) => <Input id={id} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoComplete="off" />}
          </Field>
        ) : null}
      </form>
    </Modal>
  )
}

function CredentialsDialog({ credentials, onClose }: { credentials: Credentials | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const text = credentials
    ? `Noted-Zugang\nAdresse: ${typeof location !== 'undefined' ? location.origin : ''}\nBenutzername: ${credentials.username}\nStartpasswort: ${credentials.password}\n(Bitte bei der ersten Anmeldung ändern.)`
    : ''
  return (
    <Modal
      open={!!credentials}
      onClose={onClose}
      title={credentials?.title ?? ''}
      description="Das Passwort wird nur jetzt angezeigt. Gib die Zugangsdaten sicher weiter."
      size="sm"
      footer={
        <Button variant="primary" onClick={onClose}>
          Fertig
        </Button>
      }
    >
      <div className="space-y-3">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-xl bg-subtle p-4 text-sm">
          <dt className="text-muted">Benutzername</dt>
          <dd className="font-mono">{credentials?.username}</dd>
          <dt className="text-muted">Passwort</dt>
          <dd className="font-mono text-base font-semibold break-all" data-testid="generated-password">
            {credentials?.password}
          </dd>
        </dl>
        <Button
          className="w-full"
          onClick={async () => {
            await copyText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />} Zugangsdaten kopieren
        </Button>
      </div>
    </Modal>
  )
}

function DeleteUserDialog({ user, onClose, onDeleted }: { user: AdminUser | null; onClose: () => void; onDeleted: () => void }) {
  const [confirmName, setConfirmName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [prevUser, setPrevUser] = useState<AdminUser | null>(null)
  if (user !== prevUser) {
    setPrevUser(user)
    setConfirmName('')
    setError(null)
  }
  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title="Benutzer löschen?"
      description={`Das Konto @${user?.username} wird mit allen ${user?.noteCount ?? 0} Notizen und Anhängen endgültig gelöscht.`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="danger"
            loading={loading}
            disabled={confirmName !== user?.username}
            onClick={async () => {
              if (!user) return
              setLoading(true)
              try {
                await api(`/api/admin/users/${user.id}`, { method: 'DELETE' })
                onDeleted()
              } catch (err) {
                setError(errorMessage(err))
              } finally {
                setLoading(false)
              }
            }}
          >
            Endgültig löschen
          </Button>
        </>
      }
    >
      <ErrorText className="mb-3">{error}</ErrorText>
      <Field label={`Zur Bestätigung „${user?.username}“ eingeben`}>
        {(id) => <Input id={id} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" autoCapitalize="none" />}
      </Field>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Sicherheit
// ---------------------------------------------------------------------------

function SecurityTab() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api<{ settings: { enforceMfa: boolean } }>('/api/admin/settings').then((r) => r.settings),
  })
  return (
    <div className="space-y-5">
      <Section icon={<ShieldCheck />} title="Zwei-Faktor-Anmeldung" description="Authenticator-App (TOTP) als zweiter Faktor.">
        <Switch
          checked={data?.enforceMfa ?? false}
          disabled={!data}
          onChange={async (v) => {
            try {
              await api('/api/admin/settings', { method: 'PATCH', body: { enforceMfa: v } })
              await qc.invalidateQueries({ queryKey: ['admin'] })
              toast.success(v ? 'MFA ist jetzt für alle Pflicht.' : 'MFA ist nicht mehr für alle Pflicht.')
              if (v) toast.show('Auch du musst MFA eingerichtet haben – sonst wirst du zur Einrichtung weitergeleitet.')
            } catch (err) {
              toast.error(errorMessage(err))
            }
          }}
          label="Für alle Benutzer verpflichtend"
          description="Wer noch keine Authenticator-App eingerichtet hat, wird beim nächsten Seitenaufruf zur Einrichtung gezwungen. Einzelne Benutzer kannst du auch gezielt unter „Benutzer → Bearbeiten“ verpflichten."
        />
      </Section>
      <Section icon={<Lock />} title="Schutzmechanismen" description="Diese Einstellungen sind fest eingebaut.">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>Keine Selbstregistrierung – Konten legt nur ein Administrator an.</li>
          <li>Passwörter werden mit Argon2id gehasht; MFA-Schlüssel sind verschlüsselt gespeichert.</li>
          <li>
            Nach 10 falschen Passwörtern wird die jeweilige IP-Adresse für dieses Konto 15 Minuten gesperrt, nach 50 Fehlversuchen
            insgesamt das ganze Konto. Nach 5 falschen MFA-Codes wird jede weitere Sperre doppelt so lang (bis 24 Stunden).
          </li>
          <li>Sitzungen laufen nach 30 Tagen Inaktivität ab und werden bei Passwortänderung auf anderen Geräten beendet.</li>
          <li>
            Jeder Benutzer sieht ausschließlich seine eigenen Notizen; Administratoren können fremde Notizen nicht öffnen. Setzt
            ein Admin Passwort oder MFA zurück, wird das protokolliert und fällt dem Benutzer bei der nächsten Anmeldung auf.
          </li>
        </ul>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Protokoll
// ---------------------------------------------------------------------------

type AuditEntry = {
  id: number
  createdAt: number
  event: string
  userId: number | null
  username: string | null
  actorId: number | null
  actorUsername: string | null
  ip: string | null
  details: string | null
}

const EVENTS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' }> = {
  login_success: { label: 'Anmeldung', tone: 'success' },
  login_failed: { label: 'Fehlgeschlagene Anmeldung', tone: 'warning' },
  login_locked: { label: 'Konto gesperrt', tone: 'danger' },
  login_inactive: { label: 'Anmeldung deaktiviertes Konto', tone: 'warning' },
  mfa_failed: { label: 'Falscher MFA-Code', tone: 'warning' },
  logout: { label: 'Abmeldung', tone: 'neutral' },
  password_changed: { label: 'Passwort geändert', tone: 'accent' },
  mfa_enabled: { label: 'MFA aktiviert', tone: 'success' },
  mfa_disabled: { label: 'MFA deaktiviert', tone: 'warning' },
  session_revoked: { label: 'Sitzung beendet', tone: 'neutral' },
  user_created: { label: 'Benutzer angelegt', tone: 'accent' },
  user_updated: { label: 'Benutzer geändert', tone: 'accent' },
  user_deleted: { label: 'Benutzer gelöscht', tone: 'danger' },
  password_reset: { label: 'Passwort zurückgesetzt', tone: 'accent' },
  mfa_reset: { label: 'MFA zurückgesetzt', tone: 'warning' },
  sessions_revoked_by_admin: { label: 'Sitzungen beendet (Admin)', tone: 'warning' },
  settings_changed: { label: 'Einstellungen geändert', tone: 'accent' },
}

function AuditTab() {
  const query = useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<{ entries: AuditEntry[] }>(`/api/admin/audit?limit=100${pageParam ? `&before=${pageParam}` : ''}`).then((r) => r.entries),
    getNextPageParam: (last) => (last.length === 100 ? last[last.length - 1].id : undefined),
  })
  const entries = query.data?.pages.flat() ?? []
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Sicherheitsrelevante Ereignisse der letzten 180 Tage.</p>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-elevated">
        {entries.map((e) => {
          const ev = EVENTS[e.event] ?? { label: e.event, tone: 'neutral' as const }
          let details = ''
          try {
            const d = e.details ? JSON.parse(e.details) : null
            if (d && typeof d === 'object') {
              details = Object.entries(d)
                .filter(([k]) => k !== 'failed')
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(', ')
            }
          } catch {
            details = e.details ?? ''
          }
          return (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="w-36 shrink-0 text-xs text-faint tabular-nums">{formatDateTime(e.createdAt)}</span>
              <Badge tone={ev.tone}>{ev.label}</Badge>
              <span className="min-w-0 flex-1 truncate">
                {e.username ? <span className="font-medium">@{e.username}</span> : null}
                {e.actorUsername && e.actorUsername !== e.username ? <span className="text-muted"> durch @{e.actorUsername}</span> : null}
                {details ? <span className="text-faint"> · {details}</span> : null}
              </span>
              {e.ip ? <span className="text-xs text-faint tabular-nums">{e.ip}</span> : null}
            </li>
          )
        })}
        {entries.length === 0 && !query.isLoading ? <li className="px-4 py-8 text-center text-sm text-muted">Keine Einträge.</li> : null}
      </ul>
      {query.hasNextPage ? (
        <Button onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
          Ältere laden
        </Button>
      ) : null}
    </div>
  )
}
