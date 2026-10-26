import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { foldedRanges, foldEffect } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { sectionAt, sectionFolding } from './client/editor/folding'

// Wie im Editor: Markdown samt Frontmatter
const create = (doc: string) =>
  EditorState.create({ doc, extensions: [yamlFrontmatter({ content: markdown({ base: markdownLanguage }) }), sectionFolding()] })

const DOC = [
  '---',
  'tags: [a]',
  '---',
  '# Kapitel 1',
  'Text 1',
  '## Kapitel 1.1',
  'Text 1.1',
  '# Kapitel 2',
  '```',
  '# Kein Kapitel',
  '```',
  'Ende',
].join('\n')

const lineOf = (state: EditorState, text: string) => {
  for (let n = 1; n <= state.doc.lines; n++) if (state.doc.line(n).text === text) return state.doc.line(n)
  throw new Error(text)
}

describe('Abschnitte einklappen', () => {
  it('reicht bis zur nächsten Überschrift gleicher oder höherer Ebene', () => {
    const state = create(DOC)
    const k1 = lineOf(state, '# Kapitel 1')
    const section = sectionAt(state, k1.from)!
    expect(section.line.text).toBe('# Kapitel 1')
    expect(state.sliceDoc(section.range.from, section.range.to)).toBe('\nText 1\n## Kapitel 1.1\nText 1.1')
    const sub = sectionAt(state, lineOf(state, 'Text 1.1').from)!
    expect(sub.line.text).toBe('## Kapitel 1.1')
  })

  it('gilt für den letzten Abschnitt bis zum Ende und nicht für Überschriften in Code', () => {
    const state = create(DOC)
    const inCode = sectionAt(state, lineOf(state, '# Kein Kapitel').from)!
    expect(inCode.line.text).toBe('# Kapitel 2')
    expect(inCode.range.to).toBe(state.doc.length)
  })

  it('kennt vor der ersten Überschrift und im Frontmatter keinen Abschnitt', () => {
    const state = create(DOC)
    expect(sectionAt(state, lineOf(state, 'tags: [a]').from)).toBeNull()
    expect(sectionAt(create('Nur Text\nohne Überschrift'), 3)).toBeNull()
  })

  it('erkennt Setext-Überschriften an ihrer ersten Zeile', () => {
    const state = create('Titel\n=====\nInhalt\n\nZweiter\n-------\nMehr')
    expect(sectionAt(state, state.doc.line(3).from)?.line.text).toBe('Titel')
    expect(sectionAt(state, state.doc.line(7).from)?.line.text).toBe('Zweiter')
  })

  it('klappt auf, wenn an der eingeklappten Überschrift oder am Ende ihres Abschnitts getippt wird – sonst nicht', () => {
    let state = create(DOC)
    const k1 = lineOf(state, '# Kapitel 1')
    const { range } = sectionAt(state, k1.from)!
    state = state.update({ effects: foldEffect.of(range) }).state
    expect(sectionAt(state, k1.from)?.folded).toBe(true)

    const elsewhere = state.update({ changes: { from: state.doc.length, insert: '!' } }).state
    expect(foldedRanges(elsewhere).size).toBe(1)
    const nextSection = state.update({ changes: { from: range.to + 1, insert: '!' } }).state
    expect(foldedRanges(nextSection).size).toBe(1)

    const typed = state.update({ changes: { from: k1.from + 2, insert: 'Neues ' } }).state
    expect(foldedRanges(typed).size).toBe(0)
    // Cursor rechts neben „…“ steht am Ende des versteckten Texts
    const afterPlaceholder = state.update({ changes: { from: range.to, insert: '!' } }).state
    expect(foldedRanges(afterPlaceholder).size).toBe(0)
  })
})
