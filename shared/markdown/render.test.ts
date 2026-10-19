import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './render'
import { stripComments } from './syntax'

const env = {
  resolveNote: (t: string) => (t.toLowerCase() === 'vorhanden' ? { id: 'abc', title: 'Vorhanden' } : null),
}

describe('Vorschau', () => {
  it('rendert Wikilinks (aufgelöst, unaufgelöst, Alias, Abschnitt)', () => {
    const { html } = renderMarkdown('[[Vorhanden]] [[Fehlt]] [[Vorhanden|Alias]] [[Vorhanden#Teil 2]]', env)
    expect(html).toContain('<a class="wikilink" href="/?n=abc" data-note-id="abc" data-target="Vorhanden">Vorhanden</a>')
    expect(html).toContain('class="wikilink unresolved"')
    expect(html).toContain('>Alias</a>')
    expect(html).toContain('href="/?n=abc#teil-2"')
  })

  it('bettet Bilder, PDFs und Audio ein', () => {
    const { html } = renderMarkdown('![[Tafel bild.png|300]]\n![[skript.pdf]]\n![[aufnahme.m4a]]\n![](foto.jpg)')
    expect(html).toContain('<img src="/api/files/Tafel%20bild.png" alt="Tafel bild.png" loading="lazy" class="embed-image" width="300">')
    expect(html).toContain('class="embed-file embed-pdf" href="/api/files/skript.pdf"')
    expect(html).toContain('<audio controls')
    expect(html).toContain('src="/api/files/foto.jpg"')
  })

  it('verlinkt Dateien und PDF-Seiten für den eingebauten Viewer', () => {
    const { html } = renderMarkdown('[[skript.pdf#page=12]] [[folien.pdf|Folien]] [[liste.docx]]\n\n![[skript.pdf#page=3]]', env)
    expect(html).toContain(
      '<a class="file-link file-link-pdf" href="/api/files/skript.pdf" target="_blank" rel="noopener" data-pdf="skript.pdf" data-page="12">skript.pdf, S. 12</a>',
    )
    expect(html).toContain('data-pdf="folien.pdf">Folien</a>')
    // Andere Dateien sind keine (nicht vorhandenen) Notizen
    expect(html).toContain('<a class="file-link" href="/api/files/liste.docx" target="_blank" rel="noopener">liste.docx</a>')
    expect(html).toContain('data-pdf="skript.pdf" data-page="3"><span class="embed-file-icon"></span><span>skript.pdf · Seite 3</span>')
  })

  it('behandelt Notiztitel mit Punkt nicht als Datei', () => {
    const resolve = (t: string) => (t === 'Kapitel 3.1' ? { id: 'k31', title: 'Kapitel 3.1' } : null)
    const { html } = renderMarkdown('[[Kapitel 3.1]] [[Übung 2.3]] [[Woche 2.Semester]]', { resolveNote: resolve })
    expect(html).toContain('<a class="wikilink" href="/?n=k31" data-note-id="k31" data-target="Kapitel 3.1">Kapitel 3.1</a>')
    expect(html).toContain('<a class="wikilink unresolved" href="#" data-target="Übung 2.3"')
    expect(html).toContain('data-target="Woche 2.Semester"')
    expect(html).not.toContain('file-link')
  })

  it('rendert Tags, Markierungen und Fußnoten', () => {
    const { html } = renderMarkdown('Text #uni/mathe und ==wichtig== #123 Fußnote[^1]\n\n[^1]: Quelle')
    expect(html).toContain('<a class="tag" href="/?t=uni%2Fmathe" data-tag="uni/mathe">#uni/mathe</a>')
    expect(html).toContain('<mark>wichtig</mark>')
    expect(html).not.toContain('data-tag="123"')
    expect(html).toContain('footnote')
  })

  it('rendert Überschriften nicht als Tags', () => {
    const { html } = renderMarkdown('# Titel\n## Unterpunkt')
    expect(html).toContain('<h1 id="titel">Titel</h1>')
    expect(html).toContain('<h2 id="unterpunkt">Unterpunkt</h2>')
  })

  it('rendert Callouts inkl. einklappbarer Variante', () => {
    const { html } = renderMarkdown('> [!warning] Achtung!\n> Inhalt hier\n\n> [!faq]- Frage?\n> Antwort')
    expect(html).toContain('<div class="callout callout-warning" data-callout="warning">')
    expect(html).toContain('<span class="callout-title-text">Achtung!</span>')
    expect(html).toContain('Inhalt hier')
    expect(html).toContain('<details class="callout callout-question" data-callout="faq">')
    expect(html).toContain('<summary class="callout-title">')
    expect(html).not.toContain('[!warning]')
  })

  it('rendert Callouts ohne Titel mit Standardtitel', () => {
    const { html } = renderMarkdown('> [!tip]\n> Nur Inhalt')
    expect(html).toContain('<span class="callout-title-text">Tipp</span>')
    expect(html).toContain('Nur Inhalt')
  })

  it('rendert Aufgaben mit Zeilennummern (inkl. Frontmatter-Versatz)', () => {
    const { html, properties } = renderMarkdown('---\ntags: [a]\n---\n- [ ] offen\n- [x] erledigt')
    expect(properties).toEqual({ tags: ['a'] })
    expect(html).toContain('<input type="checkbox" class="task-checkbox" data-line="3" aria-label="Aufgabe erledigt">')
    expect(html).toContain('data-line="4" checked')
    expect(html).toContain('contains-task-list')
    expect(html).not.toContain('[ ]')
  })

  it('rendert leere Aufgaben als Checkbox', () => {
    const { html } = renderMarkdown('- [ ] \n- [ ]')
    expect(html.match(/task-checkbox/g)).toHaveLength(2)
  })

  it('rendert LaTeX-Formeln mit KaTeX', () => {
    const { html } = renderMarkdown('Inline $a^2+b^2=c^2$ und\n\n$$\n\\int_0^1 x\\,dx\n$$')
    expect(html).toContain('class="katex"')
    expect(html).toContain('katex-display')
  })

  it('markiert Mermaid-Blöcke und hebt Code hervor', () => {
    const { html } = renderMarkdown('```mermaid\ngraph TD; A-->B\n```\n```python\nprint("x")\n```')
    expect(html).toContain('class="mermaid-block"')
    expect(html).toContain('hljs-built_in')
  })

  it('entfernt Kommentare, aber nicht in Code-Blöcken', () => {
    expect(stripComments('a %%geheim%% b')).toBe('a  b')
    expect(stripComments('```\n%%bleibt%%\n```')).toBe('```\n%%bleibt%%\n```')
    const { html } = renderMarkdown('Sichtbar %%unsichtbar%%')
    expect(html).not.toContain('unsichtbar')
  })
})
