'use client'
// Markierungen über den Seiten des pdf.js-Viewers: eine eigene Ebene je Seite (unter dem Text-Layer, ohne
// Mausereignisse, damit sich Text weiter auswählen lässt). Positionen in Prozent der Seite – so sitzen sie auch
// während des Zoomens an der Textstelle, wenn pdf.js die Seite erst per CSS skaliert und später neu zeichnet.
import { annotationAt, mergeLineRects, toPdfPoint, toPdfRect, toViewRect, type ViewRect } from '../geometry'
import type { PdfAnnotation, PdfRect } from '../types'

/** Was die Ebene von einer Seite des Viewers braucht (Ausschnitt aus PDFPageView) */
export type PageView = { div: HTMLElement; viewport: { width: number; height: number; transform: number[] } }

const LAYER_CLASS = 'pdf-annotation-layer'

/** Markierungen einer Seite (neu) zeichnen – pdf.js entfernt fremde Ebenen beim Neuzeichnen, daher bei Bedarf anlegen */
export function drawAnnotations(view: PageView, list: PdfAnnotation[], state: { activeId: string | null; flashId: string | null }) {
  let layer = view.div.querySelector<HTMLElement>(`:scope > .${LAYER_CLASS}`)
  if (list.length === 0) {
    layer?.remove()
    return
  }
  if (!layer) {
    layer = document.createElement('div')
    layer.className = LAYER_CLASS
    // Direkt über dem Seitenbild, unter dem Text-Layer
    const canvas = view.div.querySelector(':scope > .canvasWrapper')
    if (canvas) canvas.after(layer)
    else view.div.prepend(layer)
  }
  const { width, height, transform } = view.viewport
  const boxes = list.flatMap((a) =>
    a.rects.map((rect, i) => {
      const r = toViewRect(transform, rect)
      const el = document.createElement('div')
      el.className = 'pdf-annotation'
      el.dataset.annotationId = a.id
      el.dataset.kind = a.kind === 'area' ? 'area' : 'text'
      el.dataset.color = String(a.color)
      // Kommentar-Hinweis an der ersten Zeile
      if (i === 0 && a.comment) el.classList.add('has-comment')
      if (a.id === state.activeId) el.classList.add('is-active')
      if (a.id === state.flashId) el.classList.add('is-flashing')
      el.style.left = `${(r.left / width) * 100}%`
      el.style.top = `${(r.top / height) * 100}%`
      el.style.width = `${(r.width / width) * 100}%`
      el.style.height = `${(r.height / height) * 100}%`
      return el
    }),
  )
  layer.replaceChildren(...boxes)
}

/** Bildschirm → Einheiten des Viewports (bei CSS-Zoom unterscheiden sie sich kurz) */
function toViewport(view: PageView) {
  const box = view.div.getBoundingClientRect()
  const sx = view.viewport.width / box.width
  const sy = view.viewport.height / box.height
  return (r: { left: number; top: number; width: number; height: number }): ViewRect => ({
    left: (r.left - box.left) * sx,
    top: (r.top - box.top) * sy,
    width: r.width * sx,
    height: r.height * sy,
  })
}

/**
 * Auswahl auf einer Seite: Text und Rechtecke in PDF-Koordinaten (eines je Zeile). Es zählt nur der Text-Layer der
 * Seite – reicht die Auswahl darüber hinaus (z. B. in die Leisten des Viewers), bleibt der Rest außen vor.
 */
export function selectionOnPage(range: Range, view: PageView): { text: string; rects: PdfRect[] } {
  const layer = view.div.querySelector('.textLayer')
  if (!layer || !range.intersectsNode(layer)) return { text: '', rects: [] }
  const convert = toViewport(view)
  const rects: ViewRect[] = []
  let text = ''
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!range.intersectsNode(node)) continue
    // pdf.js trennt Zeilen mit <br>
    if (node.nodeName === 'BR') text += '\n'
    if (!(node instanceof Text)) continue
    const part = document.createRange()
    part.selectNodeContents(node)
    if (node === range.startContainer) part.setStart(node, range.startOffset)
    if (node === range.endContainer) part.setEnd(node, range.endOffset)
    text += part.toString()
    for (const r of part.getClientRects()) rects.push(convert(r))
  }
  return { text, rects: mergeLineRects(rects).map((r) => toPdfRect(view.viewport.transform, r)) }
}

/** Kleiner als so viele Bildschirmpunkte ist ein aufgezogener Bereich eher ein versehentlicher Klick */
const MIN_AREA = 8

type Point = { x: number; y: number }

/**
 * Bereich zwischen zwei Bildschirmpunkten, auf die Seite beschnitten: in Prozent der Seite (zum Zeichnen beim Ziehen)
 * und in PDF-Koordinaten; `big`: groß genug für eine Markierung
 */
export function areaOnPage(view: PageView, from: Point, to: Point): { percent: ViewRect; rect: PdfRect; big: boolean } {
  const box = view.div.getBoundingClientRect()
  const clampX = (x: number) => Math.min(box.right, Math.max(box.left, x))
  const clampY = (y: number) => Math.min(box.bottom, Math.max(box.top, y))
  const left = clampX(Math.min(from.x, to.x))
  const top = clampY(Math.min(from.y, to.y))
  const width = clampX(Math.max(from.x, to.x)) - left
  const height = clampY(Math.max(from.y, to.y)) - top
  const screen = { left, top, width, height }
  return {
    percent: {
      left: ((left - box.left) / box.width) * 100,
      top: ((top - box.top) / box.height) * 100,
      width: (width / box.width) * 100,
      height: (height / box.height) * 100,
    },
    rect: toPdfRect(view.viewport.transform, toViewport(view)(screen)),
    big: width >= MIN_AREA && height >= MIN_AREA,
  }
}

/** Markierung unter dem Mauszeiger bzw. Finger */
export function annotationAtPoint(view: PageView, list: PdfAnnotation[], clientX: number, clientY: number): PdfAnnotation | null {
  const p = toViewport(view)({ left: clientX, top: clientY, width: 0, height: 0 })
  const [x, y] = toPdfPoint(view.viewport.transform, p.left, p.top)
  return annotationAt(list, x, y)
}
