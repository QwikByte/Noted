'use client'
// Eingebettete Notizen in der Vorschau (![[Notiz]], ![[Notiz#Abschnitt]]). Wer sie zeigen will, stellt über den
// EmbedContext bereit, wie eine Einbettung gezeichnet wird – die Vorschau selbst kennt die Komponente nicht, denn
// diese rendert ihrerseits wieder eine Vorschau.
import { createContext, type ComponentType } from 'react'

/** Ebenen: Die Notiz zeigt eingebettete Notizen und diese wiederum ihre – tiefer bleibt es bei der Link-Karte */
export const MAX_EMBED_DEPTH = 2
/** Höchstens so viele Einbettungen je Notiz, die übrigen bleiben Link-Karten */
export const MAX_EMBEDS = 20

/**
 * Eine Einbettung: die Notiz (Abschnitt, Ziel und Adresse aus dem Link) und Bescheid, sobald sie gezeichnet ist oder
 * nicht geladen werden kann – der Druck wartet darauf
 */
export type EmbedProps = { noteId: string; heading: string | null; title: string; href: string; onSettled: () => void }

export type EmbedContextValue = {
  /** Notizen von der obersten bis zu dieser – für die Tiefe und gegen Zyklen (A bettet B ein, B bettet A ein) */
  chain: string[]
  Embed: ComponentType<EmbedProps> | null
  /** Für die Druckansicht (siehe RenderEnv.print) */
  print?: boolean
}

export const EmbedContext = createContext<EmbedContextValue>({ chain: [], Embed: null })
