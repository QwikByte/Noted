// Wo steht eine Stelle im Markdown? Properties, Code, Kommentare und Formeln sind kein Fließtext – dort sind „/“,
// „[[…]]“ und eingefügtes HTML einfach Zeichen. Reine Logik ohne DOM.
import { splitFrontmatter, stripCode } from '@/shared/markdown/meta'

const MARK = '\u0001'

/** Einzelne, nicht maskierte „$“ (ohne „$$“) */
const countDollars = (text: string) => (text.replace(/\$\$/g, '').match(/(?<!\\)\$/g) ?? []).length
const countBlockMath = (text: string) => (text.match(/\$\$/g) ?? []).length

/** Steht die Stelle `pos` im Fließtext – nicht in Properties, Code, Kommentaren oder Formeln? */
export function isProseAt(doc: string, pos: number): boolean {
  const fm = splitFrontmatter(doc)
  const bodyStart = fm ? doc.length - fm.body.length : 0
  if (pos < bodyStart) return false
  // Code und Kommentare sind danach Leerzeichen – ein Zeichen an der Stelle zeigt es auch auf leeren Zeilen im Block
  const plain = stripCode(doc.slice(0, pos) + MARK + doc.slice(pos))
  if (plain[pos] !== MARK) return false
  if (countBlockMath(plain.slice(bodyStart, pos)) % 2 === 1) return false
  const lineStart = doc.lastIndexOf('\n', pos - 1) + 1
  return countDollars(plain.slice(lineStart, pos)) % 2 === 0
}
