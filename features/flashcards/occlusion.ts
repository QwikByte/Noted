// Bildverdeckung (Image Occlusion): Flächen über einem Bild – z. B. den Beschriftungen eines Diagramms – werden
// einzeln abgefragt. Lage und Größe sind relativ zum Bild (0–1), damit sie bei jeder Anzeigegröße passen.
// Reine Logik ohne Browser- oder Server-Abhängigkeit.
import { IMAGE_EXT } from '@/shared/markdown/syntax'
import { MAX_MASK_LABEL, MAX_MASKS } from './limits'
import type { Occlusion, OcclusionMask } from './types'

/** Kleinste Kantenlänge einer Fläche (Anteil am Bild) – kleinere entstehen meist nur durch einen Klick */
export const MIN_MASK_SIZE = 0.01

const round = (n: number) => Math.round(n * 10_000) / 10_000
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** Fläche ins Bild einpassen und auf vier Nachkommastellen runden */
export function fitMask(m: OcclusionMask): OcclusionMask {
  const w = clamp(m.w, 0, 1)
  const h = clamp(m.h, 0, 1)
  return {
    x: round(clamp(m.x, 0, 1 - w)),
    y: round(clamp(m.y, 0, 1 - h)),
    w: round(w),
    h: round(h),
    label: m.label.replace(/\s+/g, ' ').trim(),
  }
}

/** Fläche um dx/dy (Anteile am Bild) verschieben – sie bleibt ganz im Bild, die Beschriftung bleibt, wie sie ist */
export function moveMask(m: OcclusionMask, dx: number, dy: number): OcclusionMask {
  return { ...fitMask({ ...m, x: m.x + dx, y: m.y + dy }), label: m.label }
}

/** Breite und Höhe ändern, die linke obere Ecke bleibt: nicht kleiner als MIN_MASK_SIZE, nicht über das Bild hinaus */
export function resizeMask(m: OcclusionMask, dw: number, dh: number): OcclusionMask {
  const w = clamp(m.w + dw, MIN_MASK_SIZE, 1 - m.x)
  const h = clamp(m.h + dh, MIN_MASK_SIZE, 1 - m.y)
  return { ...fitMask({ ...m, w, h }), label: m.label }
}

/** Größe einer Fläche, die per Knopf statt durch Ziehen entsteht (Anteil am Bild) */
const NEW_MASK_SIZE = { w: 0.2, h: 0.12 }
/** Versatz jeder weiteren neuen Fläche – sonst lägen sie genau übereinander und sähen aus wie eine */
const NEW_MASK_OFFSET = 0.03

/** Neue Fläche in der Mitte des Bilds; liegt dort schon eine, schräg darunter versetzt */
export function newMask(masks: OcclusionMask[]): OcclusionMask {
  let m = fitMask({ x: (1 - NEW_MASK_SIZE.w) / 2, y: (1 - NEW_MASK_SIZE.h) / 2, ...NEW_MASK_SIZE, label: '' })
  const taken = (at: OcclusionMask) =>
    masks.some((o) => Math.abs(o.x - at.x) < NEW_MASK_OFFSET / 2 && Math.abs(o.y - at.y) < NEW_MASK_OFFSET / 2)
  // Am Bildrand geht es nicht weiter – spätestens nach so vielen Schritten, wie es Flächen gibt, ist Schluss
  for (let i = 0; i < masks.length && taken(m); i++) {
    m = fitMask({ ...m, x: m.x + NEW_MASK_OFFSET, y: m.y + NEW_MASK_OFFSET })
  }
  return m
}

/** Fehlermeldung für die Oberfläche, null = in Ordnung */
export function occlusionError(o: Occlusion): string | null {
  if (!o.image.trim()) return 'Bitte wähle ein Bild.'
  if (!IMAGE_EXT.test(o.image)) return 'Bitte wähle ein Bild (z. B. PNG oder JPG).'
  if (o.masks.length === 0) return 'Zieh mindestens eine Fläche über das Bild.'
  if (o.masks.length > MAX_MASKS) return `Höchstens ${MAX_MASKS} Flächen pro Karte.`
  if (o.masks.some((m) => m.w < MIN_MASK_SIZE || m.h < MIN_MASK_SIZE)) return 'Eine Fläche ist zu klein.'
  if (o.masks.some((m) => m.label.length > MAX_MASK_LABEL)) return 'Eine Beschriftung ist zu lang.'
  return null
}

/** Name einer Fläche für Listen und den Export: die Beschriftung oder „Fläche 3“ */
export const maskName = (o: Occlusion, index: number) => o.masks[index]?.label || `Fläche ${index + 1}`
