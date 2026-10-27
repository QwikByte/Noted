// Claude-Modelle, aus denen jedes Konto wählt – der Server lässt nur diese zu, die Einstellungen zeigen sie an.

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: 'Empfohlen: sehr gute Karten zu einem mittleren Preis.' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', description: 'Schneller und etwa halb so teuer wie Opus.' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', description: 'Am schnellsten und günstigsten – für einfache Notizen.' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', description: 'Das stärkste Modell, aber deutlich teurer und langsamer.' },
] as const

export type AiModel = (typeof AI_MODELS)[number]['id']

export const DEFAULT_MODEL: AiModel = 'claude-opus-5-5'

export const isAiModel = (value: string): value is AiModel => AI_MODELS.some((m) => m.id === value)

export const modelLabel = (id: AiModel) => AI_MODELS.find((m) => m.id === id)?.label ?? id
