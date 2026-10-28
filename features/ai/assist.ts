// KI-Assistent: Schnellaktionen, Anweisungen für Ändern und Antworten und das Zeilenformat der gestreamten Antwort.
// Reine Logik – den Aufruf macht server/assist.ts, die Oberfläche components/AiAssistant.tsx.
import { imagePart, textPart, type Prompt, type PromptPart } from './prompt'
import type { AssistEvent, AssistRequest, AssistTask } from './types'

/** Schnellaktion: `task` bestimmt, ob das Ergebnis den Text ersetzt (`edit`) oder eine Antwort dazu ist (`answer`) */
export type AssistAction = { id: string; label: string; task: AssistTask; instruction: string }

export const ASSIST_ACTIONS: AssistAction[] = [
  {
    id: 'improve',
    label: 'Verbessern',
    task: 'edit',
    instruction: 'Formuliere den Text klarer und flüssiger, ohne den Inhalt zu ändern.',
  },
  {
    id: 'fix',
    label: 'Korrigieren',
    task: 'edit',
    instruction: 'Korrigiere Rechtschreibung, Grammatik und Zeichensetzung. Ändere sonst nichts.',
  },
  {
    id: 'shorten',
    label: 'Kürzen',
    task: 'edit',
    instruction: 'Kürze den Text auf das Wesentliche.',
  },
  {
    id: 'expand',
    label: 'Ausführlicher',
    task: 'edit',
    instruction: 'Formuliere den Text ausführlicher: Ergänze Erklärungen und Beispiele, die sich aus dem Inhalt ergeben.',
  },
  {
    id: 'structure',
    label: 'Gliedern',
    task: 'edit',
    instruction:
      'Bring die Mitschrift in eine klare Gliederung mit Überschriften, Absätzen und Listen. Behalte alle Inhalte.',
  },
  {
    id: 'bullets',
    label: 'Stichpunkte',
    task: 'edit',
    instruction: 'Fasse den Text als Liste knapper Stichpunkte zusammen.',
  },
  {
    id: 'translate',
    label: 'Übersetzen',
    task: 'edit',
    instruction: 'Übersetze den Text ins Deutsche – ist er schon Deutsch, ins Englische.',
  },
  {
    id: 'explain',
    label: 'Erklären',
    task: 'answer',
    instruction: 'Erkläre den Inhalt verständlich, als Hilfe beim Lernen für eine Prüfung.',
  },
  {
    id: 'summarize',
    label: 'Zusammenfassen',
    task: 'answer',
    instruction: 'Fasse den Inhalt kurz und übersichtlich zusammen.',
  },
]

const EDIT_SYSTEM = `Du hilfst Studierenden, ihre Notizen zu überarbeiten. Du bekommst einen Text und einen Auftrag.
Antworte ausschließlich mit dem neuen Text – ohne Einleitung, ohne Erklärung, ohne Codeblock drumherum. Er ersetzt den bisherigen Text unverändert.
Behalte Formatierung, Formeln ($…$), Wikilinks ([[…]]), Tags (#…), Bilder und Links bei, sofern der Auftrag nichts anderes verlangt. Schreib in der Sprache des Textes, sofern der Auftrag nichts anderes verlangt. Ergänze keine Fakten, die nicht im Text stehen, außer der Auftrag verlangt es.`

const ANSWER_SYSTEM = `Du hilfst Studierenden beim Lernen mit ihren Notizen, Skripten und Folien. Du bekommst Inhalt (Text, bei PDFs auch Bilder der Seiten) und einen Auftrag oder eine Frage dazu.
Antworte knapp, genau und gut gegliedert, in der Sprache der Frage. Formeln schreibst du in LaTeX mit $…$ bzw. $$…$$. Stütze dich auf den mitgeschickten Inhalt; nutzt du Wissen, das darüber hinausgeht, sag das. Keine Einleitung wie „Gerne“ und keine Rückfragen am Ende.`

const PLAIN = 'Der Text ist einfacher Text ohne Markdown – schreib ebenso ohne Markdown.'
const MARKDOWN = 'Schreib in Markdown.'

/** Anfrage an Claude für den Assistenten */
export function assistPrompt(req: AssistRequest): Prompt {
  const system = `${req.task === 'edit' ? EDIT_SYSTEM : ANSWER_SYSTEM}\n${req.plain ? PLAIN : MARKDOWN}`
  const parts: PromptPart[] = [textPart(`Titel: ${req.title.trim() || 'Ohne Titel'}`)]
  for (const image of req.images ?? []) parts.push(imagePart(image))
  if (req.context?.trim()) {
    parts.push(textPart(`Zusammenhang, nur zum Verständnis:\n<kontext>\n${req.context.trim()}\n</kontext>`))
  }
  if (req.text.trim()) {
    const label = req.context?.trim() ? 'Ausgewählter Abschnitt' : req.task === 'edit' ? 'Text' : 'Inhalt'
    parts.push(textPart(`${label}:\n<text>\n${req.text}\n</text>`))
  }
  parts.push(textPart(`Auftrag: ${req.instruction.trim()}`))
  return { system, parts }
}

/**
 * Gestreamte Antwort lesen: vollständige Zeilen als Ereignisse, der unvollständige Rest bleibt für den nächsten Teil.
 * Kaputte Zeilen werden übersprungen.
 */
export function readAssistEvents<T = AssistEvent>(buffer: string): { events: T[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  const events: T[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line) as T)
    } catch {
      // Unvollständige oder fremde Zeile – nichts, was sich anzeigen ließe
    }
  }
  return { events, rest }
}

/** Ergebnis ohne Codeblock drumherum – manchmal packt Claude den Text trotz Anweisung in ```markdown … ``` */
export function stripFence(text: string): string {
  const m = /^\s*```[\w-]*\n([\s\S]*?)\n```\s*$/.exec(text)
  return m ? m[1] : text
}
