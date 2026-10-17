// Glossar und Formelsammlung: Typen der API zwischen Server und Browser

/** Ort in einer Notiz – `heading`: Überschrift darüber (Sprungziel), null vor der ersten Überschrift */
export type GlossarySource = { noteId: string; noteTitle: string; heading: string | null }

/** Definition: Info-Callout (`> [!info] Begriff`) oder fett gedruckter Begriff mit Erklärung */
export type GlossaryTerm = GlossarySource & { term: string; definition: string }

/** LaTeX-Formel als Block (`$$…$$`) */
export type GlossaryFormula = GlossarySource & { tex: string }

export type Glossary = {
  terms: GlossaryTerm[]
  formulas: GlossaryFormula[]
  /** Nicht alles passte in die Antwort (sehr viele Einträge) */
  truncated: boolean
}
