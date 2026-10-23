'use client'
// Links im Markdown-Editor: Strg/⌘-Klick öffnet sie, beim Überfahren erscheint eine kleine Vorschau – ohne erst in den
// Lesemodus zu wechseln
import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, hoverTooltip } from '@codemirror/view'
import { linkAtPos, type EditorLink } from '../../editor-links'

/** Vorschau eines Links: Titel, eine Zeile darunter (Ordner, Seite …) und ein Auszug bzw. Hinweis */
export type LinkPreview = { title: string; detail?: string; text?: string }

/** Was der Editor mit Links tun kann – stellt die Notizansicht bereit */
export type EditorLinkActions = {
  open: (link: EditorLink) => void
  describe: (link: EditorLink) => LinkPreview | null
}

const MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform)
/** Strg bzw. ⌘ auf dem Mac – dort ist Strg+Klick der Rechtsklick */
export const isLinkModifier = (e: MouseEvent | KeyboardEvent) => (MAC ? e.metaKey : e.ctrlKey)
/** „Strg-Klick“ bzw. „⌘-Klick“ für Hinweise */
export const LINK_CLICK = MAC ? '⌘-Klick' : 'Strg-Klick'

function previewDom(p: LinkPreview): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'cm-link-preview'
  const add = (cls: string, text: string | undefined) => {
    if (!text) return
    const el = document.createElement('div')
    el.className = cls
    el.textContent = text
    dom.append(el)
  }
  add('cm-link-preview-title', p.title)
  add('cm-link-preview-detail', p.detail)
  add('cm-link-preview-text', p.text)
  return dom
}

/** `actions` liefert immer die aktuellen Aktionen der Notizansicht (Notizen, Tags und Tresor ändern sich) */
export function linkExtensions(actions: () => EditorLinkActions): Extension[] {
  return [
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0 || !isLinkModifier(e)) return false
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        const link = pos === null ? null : linkAtPos(view.state.doc.toString(), pos)
        if (!link) return false
        e.preventDefault()
        actions().open(link)
        return true
      },
    }),
    // Solange Strg/⌘ gedrückt ist, sind Links unterstrichen und zeigen die Hand
    ViewPlugin.fromClass(
      class {
        constructor(private view: EditorView) {
          window.addEventListener('keydown', this.onKey)
          window.addEventListener('keyup', this.onKey)
          window.addEventListener('blur', this.onBlur)
        }
        onKey = (e: KeyboardEvent) => this.view.dom.classList.toggle('cm-links-active', isLinkModifier(e))
        onBlur = () => this.view.dom.classList.remove('cm-links-active')
        destroy() {
          window.removeEventListener('keydown', this.onKey)
          window.removeEventListener('keyup', this.onKey)
          window.removeEventListener('blur', this.onBlur)
        }
      },
    ),
    hoverTooltip(
      (view, pos) => {
        const link = linkAtPos(view.state.doc.toString(), pos)
        const preview = link ? actions().describe(link) : null
        return preview ? { pos, above: true, create: () => ({ dom: previewDom(preview) }) } : null
      },
      { hoverTime: 400 },
    ),
  ]
}
