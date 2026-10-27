// Anfragen an Claude, beschrieben ohne das SDK: Anweisung und Inhalt aus Text und Bildern in dieser Reihenfolge.
// server/claude.ts macht daraus die Inhaltsblöcke der API – so bleiben Anweisungen und Aufbau testbar.
import type { AiImage } from './types'

export type PromptPart = { kind: 'text'; text: string } | { kind: 'image'; image: AiImage }

export type Prompt = { system: string; parts: PromptPart[] }

export const textPart = (text: string): PromptPart => ({ kind: 'text', text })

export const imagePart = (image: AiImage): PromptPart => ({ kind: 'image', image })

/** Vorderseiten vorhandener Karten – zum Wiedererkennen reicht der Anfang, lange Vorderseiten kosteten nur Tokens */
export function existingCardsPart(existing: string[] | undefined, intro: string): PromptPart[] {
  const fronts = (existing ?? []).map((f) => f.replace(/\s+/g, ' ').trim().slice(0, 300)).filter(Boolean)
  return fronts.length ? [textPart(`${intro}\n${fronts.map((f) => `- ${f}`).join('\n')}`)] : []
}
