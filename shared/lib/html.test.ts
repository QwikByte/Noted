import { describe, expect, it } from 'vitest'
import { decodeEntities, htmlBody, htmlDocument, htmlToText, textToHtml } from './html'

describe('htmlToText', () => {
  it('macht aus Blöcken Zeilen und dekodiert Entities', () => {
    const html = '<h2>Kapitel&nbsp;3</h2><p>Das ist <strong>wichtig</strong> &amp; gut.</p><ul><li><p>eins</p></li><li><p>zwei</p></li></ul>'
    expect(htmlToText(html)).toBe('Kapitel 3\n\nDas ist wichtig & gut.\n\neins\n\nzwei')
  })

  it('übernimmt Zeilenumbrüche, Tabellenzellen und Zahl-Entities', () => {
    expect(htmlToText('<p>a<br>b</p><table><tr><td>x</td><td>y</td></tr></table><p>&#228;&#x00FC;</p>')).toBe('a\nb\n\nx y\n\näü')
  })

  it('ignoriert Skripte, Stile, Kommentare und den Kopf eines Dokuments', () => {
    const html = '<html><head><title>T</title><style>p{}</style></head><body><!-- x --><p>Text</p><script>alert("<p>")</script></body></html>'
    expect(htmlToText(html)).toBe('Text')
  })

  it('setzt Code-Blöcke in ``` (abschaltbar) und behält deren Einrückung', () => {
    const html = '<p>vor</p><pre><code>if (x) {\n  #include\n}</code></pre><p>nach</p>'
    expect(htmlToText(html)).toBe('vor\n\n```\nif (x) {\n  #include\n}\n```\n\nnach')
    expect(htmlToText(html, { codeFences: false })).toBe('vor\n\nif (x) {\n  #include\n}\n\nnach')
  })

  it('kommt mit „>“ in Attributen und kaputtem HTML zurecht', () => {
    expect(htmlToText('<img alt="a > b"><p title=\'x>y\'>Text</p>')).toBe('Text')
    expect(htmlToText('<p>offen <b')).toBe('offen <b')
  })

  it('verarbeitet große und böswillige Eingaben in linearer Zeit', () => {
    for (const s of ['<'.repeat(1_000_000), '<script>'.repeat(200_000), '<a "'.repeat(300_000), '<p>x</p>'.repeat(250_000)]) {
      const t = Date.now()
      htmlToText(s)
      expect(Date.now() - t).toBeLessThan(3000)
    }
  })
})

describe('HTML-Hilfen', () => {
  it('macht aus einfachem Text Absätze', () => {
    expect(textToHtml('Zeile 1\nZeile <2>\n\n\nAbsatz & mehr')).toBe('<p>Zeile 1<br>Zeile &lt;2&gt;</p><p>Absatz &amp; mehr</p>')
    expect(textToHtml('  \n ')).toBe('')
  })

  it('baut Dokumente und liest deren Inhalt wieder aus', () => {
    const doc = htmlDocument('Tom & Jerry <3', '<p>Hallo</p>')
    expect(doc).toContain('<title>Tom &amp; Jerry &lt;3</title>')
    expect(htmlBody(doc)).toBe('<p>Hallo</p>')
    expect(htmlBody('<p>nur ein Ausschnitt</p>')).toBe('<p>nur ein Ausschnitt</p>')
    expect(htmlBody('<html><body class="x">Text')).toBe('Text')
  })

  it('lässt unbekannte Entities stehen', () => {
    expect(decodeEntities('&foo; &#0; &#xD800; &amp;')).toBe('&foo; &#0; &#xD800; &')
  })
})
