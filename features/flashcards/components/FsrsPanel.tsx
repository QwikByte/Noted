'use client'
// Eigene FSRS-Parameter (Lernstatistik): aus dem Lernverlauf optimieren oder zu den Standardwerten zurück
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Panel } from '@/shared/ui/panel'
import { Button } from '@/shared/ui/button'
import { ConfirmModal } from '@/shared/ui/modal'
import { useToast } from '@/shared/ui/toast'
import { errorMessage } from '@/shared/client/api'
import { optimizeFsrs, resetFsrs } from '../client/flashcards'
import type { FsrsMetrics, FsrsParams } from '../types'

const percent = (rmse: number) =>
  `${(rmse * 100).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
const logLoss = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

function Metrics({ label, metrics }: { label: string; metrics: FsrsMetrics }) {
  return (
    <tr>
      <th scope="row" className="pr-5 text-left font-normal text-muted">
        {label}
      </th>
      <td className="pr-5 tabular-nums">{percent(metrics.rmse)}</td>
      <td className="tabular-nums">{logLoss(metrics.logLoss)}</td>
    </tr>
  )
}

/** `usesFsrs`: Mindestens ein Stapel plant mit FSRS – sonst wirken die Parameter (noch) nicht */
export function FsrsPanel({ fsrs, usesFsrs }: { fsrs: FsrsParams | null; usesFsrs: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [optimizing, setOptimizing] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)

  async function optimize() {
    setOptimizing(true)
    try {
      const result = await optimizeFsrs(qc)
      if (result.status === 'saved' && result.before && result.after) {
        toast.success(`Parameter angepasst – Abweichung ${percent(result.before.rmse)} → ${percent(result.after.rmse)}.`)
      } else if (result.status === 'kept') {
        toast.show('Die bisherigen Parameter passen besser zu deinem Lernverlauf – nichts geändert.')
      } else {
        toast.show(
          `Noch zu wenige Wiederholungen zum Auswerten (${result.reviews}). Lerne ein paar Tage weiter und versuche es dann noch einmal.`,
        )
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setOptimizing(false)
    }
  }

  async function reset() {
    setResetting(true)
    try {
      await resetFsrs(qc)
      setConfirmReset(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setResetting(false)
    }
  }

  return (
    <Panel title="Wiederholungsplan FSRS" testId="stats-fsrs">
      <div className="space-y-3 text-sm">
        {fsrs ? (
          <>
            <p>
              An deinen Lernverlauf angepasst am {new Date(fsrs.optimizedAt).toLocaleDateString('de-DE')} (
              {fsrs.reviews.toLocaleString('de-DE')} Wiederholungen).
            </p>
            <table className="[&_td]:py-0.5 [&_th]:py-0.5">
              <thead className="text-xs text-faint">
                <tr>
                  <th scope="col" className="pr-5 text-left font-normal">
                    Vorhersagefehler
                  </th>
                  <th scope="col" className="pr-5 text-left font-normal">
                    RMSE
                  </th>
                  <th scope="col" className="text-left font-normal">
                    Log-Loss
                  </th>
                </tr>
              </thead>
              <tbody>
                <Metrics label="Standardwerte" metrics={fsrs.defaultMetrics} />
                <Metrics label="Eigene Werte" metrics={fsrs.metrics} />
              </tbody>
            </table>
          </>
        ) : (
          <p>
            Standardwerte von FSRS-5. „Parameter optimieren“ passt sie an deinen Lernverlauf an – lohnt sich ab einigen
            Hundert Wiederholungen, danach etwa einmal im Monat. Gilt für alle Stapel mit FSRS.
          </p>
        )}
        {usesFsrs ? null : (
          <p className="text-muted">
            Wirkt erst, wenn du bei einem Stapel unter ⋮ → Stapel bearbeiten den Wiederholungsplan FSRS wählst.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" loading={optimizing} onClick={() => void optimize()}>
            Parameter optimieren
          </Button>
          {fsrs ? (
            <Button size="sm" onClick={() => setConfirmReset(true)} disabled={optimizing}>
              Standardwerte
            </Button>
          ) : null}
        </div>
        {optimizing ? <p className="text-xs text-faint">Kann bei vielen Bewertungen bis zu einer Minute dauern.</p> : null}
      </div>
      <ConfirmModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => void reset()}
        loading={resetting}
        title="Standardwerte wiederherstellen?"
        description="Deine angepassten Parameter werden gelöscht. Der Lernstand deiner Karten bleibt, wie er ist."
        confirmLabel="Standardwerte"
      />
    </Panel>
  )
}
