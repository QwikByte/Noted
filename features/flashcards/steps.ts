// Lernschritte eingeben und anzeigen wie in Anki: „1m 10m 1d“ – Minuten, Stunden oder Tage, intern in Minuten.
import { MAX_STEP_MINUTES, MAX_STEPS } from './limits'

const UNIT_MINUTES: Record<string, number> = { m: 1, h: 60, d: 1440 }

/**
 * „1m 10m 1d“ bzw. „10 60“ (ohne Einheit: Minuten) → Minuten. Wirft einen verständlichen Fehler, wenn die Eingabe nicht
 * passt: leer, unbekannte Einheit, zu viele oder zu lange Schritte.
 */
export function parseSteps(text: string): number[] {
  // Ein Komma vor Leerraum trennt Schritte, eines in der Zahl ist ein Dezimalkomma („1,5h“)
  const parts = text.trim().toLowerCase().replace(/,(\s|$)/g, ' ').split(/[\s;]+/).filter(Boolean)
  if (parts.length === 0) throw new Error('Gib mindestens einen Lernschritt an, z. B. „1m 10m“.')
  if (parts.length > MAX_STEPS) throw new Error(`Höchstens ${MAX_STEPS} Lernschritte.`)
  return parts.map((part) => {
    const m = /^(\d+(?:[.,]\d+)?)([mhd]?)$/.exec(part)
    if (!m) throw new Error(`„${part}“ ist kein Lernschritt – erlaubt sind z. B. 10m, 2h oder 1d.`)
    const minutes = Math.round(Number(m[1].replace(',', '.')) * UNIT_MINUTES[m[2] || 'm'])
    if (minutes < 1 || minutes > MAX_STEP_MINUTES) throw new Error('Ein Lernschritt dauert zwischen 1 Minute und 30 Tagen.')
    return minutes
  })
}

/** Minuten → „1m 10m 1d“ – in der größten Einheit, die glatt aufgeht */
export function formatSteps(minutes: readonly number[]): string {
  return minutes
    .map((min) => (min % 1440 === 0 ? `${min / 1440}d` : min % 60 === 0 ? `${min / 60}h` : `${min}m`))
    .join(' ')
}
