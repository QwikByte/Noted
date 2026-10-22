'use client'
// Wiederherstellungsschlüssel anzeigen: drucken, als Textdatei speichern, kopieren
import { Copy, Download, Printer } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { useToast } from '@/shared/ui/toast'
import { copyText } from '@/shared/client/clipboard'

const HINT =
  'Mit diesem Schlüssel öffnest du deinen Tresor in Noted, wenn du das Tresor-Passwort vergessen hast. Er ist so ' +
  'mächtig wie das Passwort: Bewahre ihn sicher und getrennt vom Gerät auf.'

/** Eigenes Fenster nur mit dem Schlüssel – so druckt der Browser nichts von der App mit */
function printKey(key: string): boolean {
  const w = window.open('', '_blank', 'width=640,height=480')
  if (!w) return false
  const doc = w.document
  doc.title = 'Noted – Wiederherstellungsschlüssel'
  const h1 = doc.createElement('h1')
  h1.textContent = 'Wiederherstellungsschlüssel für den Tresor'
  const pre = doc.createElement('pre')
  pre.textContent = key
  pre.style.fontSize = '24px'
  const p = doc.createElement('p')
  p.textContent = HINT
  doc.body.append(h1, pre, p)
  w.print()
  return true
}

function saveKey(key: string) {
  const blob = new Blob([`Noted – Wiederherstellungsschlüssel für den Tresor\n\n${key}\n\n${HINT}\n`], {
    type: 'text/plain;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'Noted-Wiederherstellungsschluessel.txt'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function RecoveryKeyActions({ recoveryKey }: { recoveryKey: string }) {
  const toast = useToast()
  return (
    <div className="space-y-3">
      <p
        className="rounded-xl border border-border-strong bg-bg px-4 py-3 text-center font-mono text-base font-semibold break-words select-all sm:text-lg"
        data-testid="recovery-key"
      >
        {recoveryKey}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => printKey(recoveryKey) || toast.error('Das Druckfenster wurde blockiert.')}>
          <Printer className="size-4" /> Drucken
        </Button>
        <Button size="sm" onClick={() => saveKey(recoveryKey)}>
          <Download className="size-4" /> Als Textdatei speichern
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            if (await copyText(recoveryKey)) toast.success('Wiederherstellungsschlüssel kopiert.')
            else toast.error('Kopieren nicht möglich.')
          }}
        >
          <Copy className="size-4" /> Kopieren
        </Button>
      </div>
      <p className="text-sm text-muted">{HINT}</p>
    </div>
  )
}
