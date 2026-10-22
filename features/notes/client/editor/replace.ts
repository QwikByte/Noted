'use client'
// Inhalt komplett ersetzen, ohne dass der Editor es als Eingabe speichert
import { Transaction, type Text, type TransactionSpec } from '@codemirror/state'
import { externalChange } from './setup'

/**
 * Ersetzt `doc` durch `next` – nur den geänderten Bereich, damit Cursor und frühere Rückgängig-Schritte an ihrer
 * Textstelle bleiben. `undoable: false` für Stände von außen (anderes Gerät, Konflikt, Wiederherstellen): Sonst holte
 * Strg+Z den alten Text zurück und speicherte ihn über die neue Fassung.
 */
export function docReplacement(doc: Text, next: string, undoable: boolean): TransactionSpec {
  const prev = doc.toString()
  const max = Math.min(prev.length, next.length)
  let start = 0
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++
  let end = 0
  while (end < max - start && prev.charCodeAt(prev.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) end++
  return {
    changes: { from: start, to: prev.length - end, insert: next.slice(start, next.length - end) },
    annotations: undoable ? externalChange.of(true) : [externalChange.of(true), Transaction.addToHistory.of(false)],
  }
}
