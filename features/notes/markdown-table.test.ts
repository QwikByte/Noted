import { describe, expect, it } from 'vitest'
import {
  cellAt,
  cellEnd,
  deleteColumn,
  deleteRow,
  formatTable,
  insertColumn,
  insertRow,
  isTableRow,
  moveCell,
  parseTableAt,
  setAlignment,
} from './markdown-table'

const at = (text: string, index: number) => {
  const lines = text.split('\n')
  return parseTableAt((i) => lines[i], index)
}

const TABLE = ['Text davor', '', '| Name | Wert |', '| :-- | :-: |', '| a | 1 |', '| bb | 22 |', '', 'danach'].join('\n')

describe('Tabellen erkennen', () => {
  it('findet Kopf, Trennzeile, Zeilen und Ausrichtung um die Cursorzeile', () => {
    const t = at(TABLE, 4)!
    expect(t).toMatchObject({ from: 2, to: 5, indent: '', align: ['left', 'center'] })
    expect(t.rows).toEqual([
      ['Name', 'Wert'],
      ['a', '1'],
      ['bb', '22'],
    ])
    expect(at(TABLE, 0)).toBeNull()
    expect(at(TABLE, 7)).toBeNull()
  })

  it('kennt Tabellen ohne äußere „|“ und verlangt eine Trennzeile', () => {
    expect(at('a | b\n--- | ---\n1 | 2', 2)?.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(at('| nur | eine Zeile |', 0)).toBeNull()
    expect(at('Satz mit | Strich\nnoch einer', 0)).toBeNull()
  })

  it('trennt nicht an „\\|“ – an „|“ in Code und Formeln schon, wie der Lesemodus', () => {
    expect(at('| a | b |\n| --- | --- |\n| x\\|y | z |', 2)!.rows[1]).toEqual(['x\\|y', 'z'])
    expect(at('| a | b |\n| --- | --- |\n| `x|y` | z |', 2)!.rows[1]).toEqual(['`x', 'y`', 'z'])
    expect(isTableRow('| Spalte | /')).toBe(true)
    expect(isTableRow('nur \\| maskiert')).toBe(false)
  })

  it('ordnet die Cursorstelle einer Zelle zu', () => {
    const t = at(TABLE, 5)!
    expect(cellAt(t, 5, 0, '| bb | 22 |')).toEqual({ row: 2, col: 0 })
    expect(cellAt(t, 5, 7, '| bb | 22 |')).toEqual({ row: 2, col: 1 })
    expect(cellAt(t, 3, 2, '| :-- | :-: |')).toEqual({ row: 0, col: 0 })
  })
})

describe('Tabellen ausrichten', () => {
  it('füllt Spalten auf, erhält die Ausrichtung und ergänzt fehlende Zellen', () => {
    const t = at('| Name | Wert |\n|:--|--:|\n| langer Name |\n| x | 1 | extra |', 0)!
    expect(formatTable(t)).toBe(
      [
        '| Name        | Wert |       |',
        '| :---------- | ---: | ----- |',
        '| langer Name |      |       |',
        '| x           |    1 | extra |',
      ].join('\n'),
    )
  })

  it('ist idempotent und behält die Einrückung', () => {
    const t = at('  | a | b |\n  | --- | :-: |\n  | 1 | 2 |', 1)!
    const once = formatTable(t)
    expect(once.split('\n').every((l) => l.startsWith('  |'))).toBe(true)
    expect(formatTable(at(once, 0)!)).toBe(once)
  })

  it('bleibt bei großen Tabellen schnell', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `| ${i} | Zeile ${i} | ${'x'.repeat(i % 50)} |`)
    const text = ['| a | b | c |', '| --- | --- | --- |', ...rows].join('\n')
    const t0 = Date.now()
    const t = at(text, 2500)!
    expect(formatTable(t).split('\n')).toHaveLength(5002)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})

describe('Zellen, Zeilen und Spalten', () => {
  const t = at('| a | b |\n| --- | --- |\n| 1 | 2 |', 2)!

  it('springt zur nächsten und vorigen Zelle, hinter der letzten in eine neue Zeile', () => {
    expect(moveCell(t, { row: 1, col: 0 }, 1).cell).toEqual({ row: 1, col: 1 })
    expect(moveCell(t, { row: 0, col: 1 }, 1).cell).toEqual({ row: 1, col: 0 })
    const grown = moveCell(t, { row: 1, col: 1 }, 1)
    expect(grown.cell).toEqual({ row: 2, col: 0 })
    expect(grown.table.rows).toHaveLength(3)
    expect(moveCell(t, { row: 1, col: 0 }, -1).cell).toEqual({ row: 0, col: 1 })
    expect(moveCell(t, { row: 0, col: 0 }, -1).cell).toEqual({ row: 0, col: 0 })
  })

  it('setzt den Cursor hinter den Inhalt der Zelle im ausgerichteten Text', () => {
    const lines = formatTable(t).split('\n')
    const end = cellEnd(t, { row: 1, col: 1 })
    expect(lines[end.line].slice(0, end.ch)).toBe('| 1   | 2')
    const right = setAlignment(t, { row: 1, col: 0 }, 'right').table
    const r = cellEnd(right, { row: 1, col: 0 })
    expect(formatTable(right).split('\n')[r.line].slice(0, r.ch)).toBe('|   1')
  })

  it('fügt Zeilen und Spalten ein und löscht sie – der Kopf und die letzte Spalte bleiben', () => {
    expect(insertRow(t, { row: 1, col: 0 }, false).table.rows.map((r) => r[0])).toEqual(['a', '', '1'])
    expect(insertRow(t, { row: 0, col: 0 }, false).table.rows.map((r) => r[0])).toEqual(['a', '', '1'])
    expect(insertRow(t, { row: 1, col: 0 }, true).table.rows.map((r) => r[0])).toEqual(['a', '1', ''])
    expect(deleteRow(t, { row: 1, col: 0 }).table.rows).toEqual([['a', 'b']])
    expect(deleteRow(t, { row: 0, col: 0 }).table.rows).toHaveLength(2)

    const wide = insertColumn(t, { row: 1, col: 0 }, true)
    expect(wide.table.rows).toEqual([
      ['a', '', 'b'],
      ['1', '', '2'],
    ])
    expect(wide.cell).toEqual({ row: 1, col: 1 })
    expect(insertColumn(t, { row: 1, col: 0 }, false).table.rows[0]).toEqual(['', 'a', 'b'])
    expect(deleteColumn(t, { row: 1, col: 0 }).table.rows).toEqual([['b'], ['2']])
    const single = deleteColumn(t, { row: 1, col: 0 }).table
    expect(deleteColumn(single, { row: 1, col: 0 }).table.rows).toEqual([['b'], ['2']])
  })

  it('ergibt nach jeder Änderung eine Tabelle, die wieder erkannt wird', () => {
    for (const changed of [insertRow(t, { row: 1, col: 1 }, true), insertColumn(t, { row: 0, col: 1 }, true), setAlignment(t, { row: 0, col: 0 }, 'center')]) {
      const text = formatTable(changed.table)
      expect(at(text, 0)!.rows).toEqual(changed.table.rows)
    }
  })
})
