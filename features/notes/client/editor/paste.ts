'use client'
// Formatiert einfügen im Markdown-Editor: HTML (z. B. aus Moodle, Wikipedia oder Word) wird zu Markdown, eine
// Adresse über markiertem Text zu einem Link. Strg/⌘ + Umschalt + V liefert nur Text und fügt ihn wie bisher ein.
import { StateEffect, StateField, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { sanitize } from '@/shared/markdown/sanitize'
import { isProseAt } from '../../markdown-context'
import { cleanPastedMarkdown, isNotedHtml, singleUrl } from '../../paste'

type Range = { from: number; to: number }

const setTarget = StateEffect.define<Range | null>()

/** Wohin das umgewandelte HTML kommt – wandert mit Änderungen, die bis zum Ende der Umwandlung passieren */
const pasteTarget = StateField.define<Range | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setTarget)) return e.value
    return value && tr.docChanged ? { from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1) } : value
  },
})

/** Gehört zu den Erweiterungen des Editors, damit `pasteFormatted` die Einfügestelle merken kann */
export const formattedPaste: Extension = pasteTarget

/** Einfügen abfangen, wenn es etwas umzuwandeln gibt – sonst `false`, dann fügt CodeMirror den Text ein */
export function pasteFormatted(event: ClipboardEvent, view: EditorView): boolean {
  const data = event.clipboardData
  if (!data) return false
  const { from, to } = view.state.selection.main
  // In Code, Formeln und Properties bleibt es beim Text
  if (!isProseAt(view.state.doc.toString(), from)) return false
  const text = data.getData('text/plain')
  const url = from !== to ? singleUrl(text) : null
  if (url) {
    event.preventDefault()
    const insert = `[${view.state.sliceDoc(from, to)}](${url})`
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.paste' })
    return true
  }
  const html = data.getData('text/html')
  if (!html.trim() || isNotedHtml(html)) return false
  event.preventDefault()
  view.dispatch({ effects: setTarget.of({ from, to }) })
  // Die Umwandlung braucht den Teil für formatierten Text – er wird bei Bedarf geladen (offline nur, wenn schon da)
  void import('../rich-text')
    .then(({ htmlToMarkdown }) => cleanPastedMarkdown(htmlToMarkdown(sanitize(html))))
    .catch(() => '')
    .then((markdown) => {
      const target = view.state.field(pasteTarget, false)
      if (!target) return
      const insert = markdown || text
      view.dispatch({
        changes: { from: target.from, to: target.to, insert },
        selection: { anchor: target.from + insert.length },
        effects: setTarget.of(null),
        userEvent: 'input.paste',
        scrollIntoView: true,
      })
    })
  return true
}
