'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, Link2 } from 'lucide-react'
import { Modal } from '@/shared/ui/modal'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { ErrorText, useToast } from '@/shared/ui/toast'
import { cn } from '@/shared/ui/cn'
import { copyText } from '@/shared/client/clipboard'
import { errorMessage } from '@/shared/client/api'
import { createShare, useShares } from '../client/queries'
import { SHARE_EXPIRY_DAYS } from '../limits'
import { ShareList } from './ShareList'
import type { ShareExpiry } from '../types'

const EXPIRY_LABELS = new Map<ShareExpiry, string>([
  [7, '7 Tage'],
  [30, '30 Tage'],
  [null, 'Unbegrenzt'],
])

/** Notiz per Link zum Lesen freigeben – Laufzeit wählen, Link kopieren, bestehende Links widerrufen */
export function ShareDialog({ noteId, title, onClose }: { noteId: string; title: string; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const shares = useShares(noteId)
  const [expiry, setExpiry] = useState<ShareExpiry>(30)
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      setUrl((await createShare(qc, noteId, expiry)).url)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (url && (await copyText(url))) toast.success('Link kopiert.')
    else toast.error('Kopieren nicht möglich – markiere den Link und kopiere ihn von Hand.')
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Teilen"
      description={`„${title}“ ohne Konto lesen lassen – bearbeiten kann damit niemand. Bilder und PDFs der Notiz sind dabei, Links auf andere Notizen nicht.`}
      footer={<Button onClick={onClose}>Fertig</Button>}
    >
      <div className="space-y-5">
        {url ? (
          <div className="space-y-2 rounded-xl bg-success-soft p-3">
            <div className="flex gap-2">
              <Input value={url} readOnly onFocus={(e) => e.target.select()} aria-label="Link" data-testid="share-url" />
              <Button variant="primary" onClick={() => void copy()}>
                <Copy className="size-4" /> Kopieren
              </Button>
            </div>
            <p className="text-sm text-muted">Den Link siehst du nur jetzt – kopiere ihn, bevor du den Dialog schließt.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex rounded-lg bg-subtle p-0.5" role="radiogroup" aria-label="Gültig für">
              {SHARE_EXPIRY_DAYS.map((days) => (
                <button
                  key={String(days)}
                  type="button"
                  role="radio"
                  aria-checked={expiry === days}
                  onClick={() => setExpiry(days)}
                  className={cn(
                    'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    expiry === days ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg',
                  )}
                >
                  {EXPIRY_LABELS.get(days)}
                </button>
              ))}
            </div>
            <Button variant="primary" onClick={() => void create()} loading={busy}>
              <Link2 className="size-4" /> Link erstellen
            </Button>
            <ErrorText>{error}</ErrorText>
          </div>
        )}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted">Aktive Links</h3>
          <ShareList query={shares} empty="Diese Notiz ist nicht geteilt." />
        </div>
      </div>
    </Modal>
  )
}
