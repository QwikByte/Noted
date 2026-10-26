import { describe, expect, it } from 'vitest'
import { diffLines, diffRows, type DiffPart } from './diff'

const compact = (parts: DiffPart[] | null) => parts?.map((p) => `${p.kind[0]}:${p.lines.join('|')}`)

describe('Vergleich (Diff)', () => {
  it('erkennt gleiche Texte, Anhängen, Löschen und geänderte Zeilen', () => {
    expect(compact(diffLines('a\nb', 'a\nb'))).toEqual(['s:a|b'])
    expect(compact(diffLines('a\nb', 'a\nb\nc'))).toEqual(['s:a|b', 'a:c'])
    expect(compact(diffLines('a\nb\nc', 'a\nc'))).toEqual(['s:a', 'r:b', 's:c'])
    expect(compact(diffLines('a\nalt\nc', 'a\nneu\nc'))).toEqual(['s:a', 'r:alt', 'a:neu', 's:c'])
    expect(compact(diffLines('', ''))).toEqual([])
    expect(compact(diffLines('', 'x'))).toEqual(['a:x'])
    expect(compact(diffLines('x', ''))).toEqual(['r:x'])
  })

  it('findet den kürzesten Weg auch bei mehreren Änderungen', () => {
    const parts = diffLines('A\nB\nC\nA\nB\nB\nA', 'C\nB\nA\nB\nA\nC')!
    const changed = parts.filter((p) => p.kind !== 'same').reduce((n, p) => n + p.lines.length, 0)
    // Bekanntes Beispiel aus Myers' Artikel: 5 Einfügungen und Löschungen
    expect(changed).toBe(5)
    // Rückwärts angewendet ergibt sich wieder der Ausgangstext
    const before = parts.filter((p) => p.kind !== 'added').flatMap((p) => p.lines).join('\n')
    const after = parts.filter((p) => p.kind !== 'removed').flatMap((p) => p.lines).join('\n')
    expect([before, after]).toEqual(['A\nB\nC\nA\nB\nB\nA', 'C\nB\nA\nB\nA\nC'])
  })

  it('behandelt CRLF und LF gleich', () => {
    expect(compact(diffLines('a\r\nb', 'a\nb'))).toEqual(['s:a|b'])
  })

  it('kürzt unveränderte Bereiche für die Anzeige', () => {
    const before = Array.from({ length: 20 }, (_, i) => `Zeile ${i + 1}`).join('\n')
    const after = before.replace('Zeile 10', 'Zeile zehn')
    const rows = diffRows(diffLines(before, after)!)
    expect(rows.slice(0, 4)).toEqual([
      { kind: 'skip', count: 6 },
      { kind: 'same', text: 'Zeile 7' },
      { kind: 'same', text: 'Zeile 8' },
      { kind: 'same', text: 'Zeile 9' },
    ])
    expect(rows.filter((r) => r.kind === 'removed' || r.kind === 'added')).toEqual([
      { kind: 'removed', text: 'Zeile 10' },
      { kind: 'added', text: 'Zeile zehn' },
    ])
    expect(rows.at(-1)).toEqual({ kind: 'skip', count: 7 })
    // Kurze Bereiche bleiben ganz
    expect(diffRows(diffLines('a\nb\nc', 'a\nx\nc')!).every((r) => r.kind !== 'skip')).toBe(true)
  })

  it('vergleicht 1 MB mit wenigen Änderungen schnell und gibt bei zu vielen auf', () => {
    const big = Array.from({ length: 40_000 }, (_, i) => `Zeile ${i} mit etwas Text`).join('\n')
    const t = Date.now()
    const parts = diffLines(big, big.replace('Zeile 20000 mit', 'Zeile 20000 ohne'))!
    expect(parts.filter((p) => p.kind !== 'same')).toHaveLength(2)
    expect(Date.now() - t).toBeLessThan(2000)

    const other = Array.from({ length: 5_000 }, (_, i) => `Anders ${i}`).join('\n')
    const t2 = Date.now()
    expect(diffLines(Array.from({ length: 5_000 }, (_, i) => `Eins ${i}`).join('\n'), other)).toBeNull()
    expect(Date.now() - t2).toBeLessThan(3000)
    expect(diffLines(big, `${big}x`.replace(/Zeile/g, 'Z'))).toBeNull()
  })
})
