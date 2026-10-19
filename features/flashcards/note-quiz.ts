// Notiz abfragen (Selbsttest aus der Mitschrift): Jede Überschrift, unter der direkt Text steht, wird zur Frage,
// der Text bis zur nächsten Überschrift zur Antwort. Überschriften erkennt „Karteikarten aus Notiz“ genauso – so
// lassen sich nicht gewusste Abschnitte dort über ihre Zeile vorauswählen.
import type { NoteFormat } from '@/features/notes/types'
import { splitFrontmatter } from '@/shared/markdown/meta'
import { stripComments } from '@/shared/markdown/syntax'
import { FENCE_RE, HEADING_RE } from './card-markdown'

/** Einfacher Text hat keine Überschriften – die anderen Formate werden für die Abfrage zu Markdown umgewandelt */
export const canQuiz = (format: NoteFormat) => format !== 'text'

export type QuizSection = {
  /** Überschrift ohne #-Zeichen */
  heading: string
  /** Übergeordnete Überschriften, von außen nach innen */
  path: string[]
  /** Text unter der Überschrift bis zur nächsten (ohne Kommentare) */
  body: string
  /** Zeile der Überschrift (0-basiert, inkl. Frontmatter) */
  line: number
}

/** Abschnitte einer Markdown-Notiz zum Abfragen – Überschriften ohne eigenen Text dienen nur als Zusammenhang. */
export function quizSections(markdown: string): QuizSection[] {
  const fm = splitFrontmatter(markdown)
  const offset = fm ? fm.lines : 0
  const lines = (fm ? fm.body : markdown).replace(/\r\n?/g, '\n').split('\n')
  const out: QuizSection[] = []
  const parents: { level: number; text: string }[] = []
  let current: Omit<QuizSection, 'body'> & { body: string[] } = { heading: '', path: [], line: -1, body: [] }
  let fence: string | null = null

  const flush = () => {
    if (current.line < 0) return
    const body = stripComments(current.body.join('\n')).trim()
    if (body) out.push({ ...current, body })
  }

  lines.forEach((line, i) => {
    const f = FENCE_RE.exec(line)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
    } else if (f) {
      fence = f[1]
    } else {
      const h = HEADING_RE.exec(line)
      if (h) {
        flush()
        const level = h[1].length
        while (parents.length > 0 && parents[parents.length - 1].level >= level) parents.pop()
        current = { heading: h[2], path: parents.map((p) => p.text), line: offset + i, body: [] }
        parents.push({ level, text: h[2] })
        return
      }
    }
    current.body.push(line)
  })
  flush()
  return out
}
