import { describe, expect, it } from 'vitest'
import { assistPrompt, readAssistEvents, stripFence } from './assist'
import type { PromptPart } from './prompt'

const texts = (parts: PromptPart[]) => parts.map((p) => (p.kind === 'text' ? p.text : '[Bild]'))
const IMAGE = { mediaType: 'image/png' as const, data: 'AAAA' }

describe('Assistent: Anfrage', () => {
  it('ändert einen Abschnitt mit der ganzen Notiz als Hintergrund', () => {
    const { system, parts } = assistPrompt({
      task: 'edit',
      instruction: ' Kürze den Text. ',
      title: 'Thermo',
      text: 'Ein langer Absatz.',
      context: '# Thermo\nEin langer Absatz.\nNoch mehr.',
    })
    expect(system).toContain('Antworte ausschließlich mit dem neuen Text')
    expect(system).toContain('Schreib in Markdown.')
    expect(texts(parts)).toEqual([
      'Titel: Thermo',
      'Zusammenhang, nur zum Verständnis:\n<kontext>\n# Thermo\nEin langer Absatz.\nNoch mehr.\n</kontext>',
      'Ausgewählter Abschnitt:\n<text>\nEin langer Absatz.\n</text>',
      'Auftrag: Kürze den Text.',
    ])
  })

  it('beantwortet Fragen zu PDF-Seiten mit Bildern – einfacher Text ohne Markdown', () => {
    const { system, parts } = assistPrompt({
      task: 'answer',
      instruction: 'Erkläre das.',
      title: 'Skript.pdf',
      text: 'Seite 2: Entropie',
      images: [IMAGE],
      plain: true,
    })
    expect(system).toContain('Antworte knapp')
    expect(system).toContain('ohne Markdown')
    expect(texts(parts)).toEqual(['Titel: Skript.pdf', '[Bild]', 'Inhalt:\n<text>\nSeite 2: Entropie\n</text>', 'Auftrag: Erkläre das.'])
  })
})

describe('Assistent: Antwort', () => {
  it('liest ganze Zeilen und behält den Rest für den nächsten Teil', () => {
    const first = readAssistEvents('{"text":"Hal')
    expect(first).toEqual({ events: [], rest: '{"text":"Hal' })
    const second = readAssistEvents(first.rest + 'lo"}\n{"reset":true}\n\nkaputt\n{"done":true,"truncated":false}\n{"te')
    expect(second.events).toEqual([{ text: 'Hallo' }, { reset: true }, { done: true, truncated: false }])
    expect(second.rest).toBe('{"te')
  })

  it('nimmt einen Codeblock um das ganze Ergebnis weg', () => {
    expect(stripFence('```markdown\n# Titel\nText\n```')).toBe('# Titel\nText')
    expect(stripFence('Text mit\n```js\ncode\n```\ndanach')).toBe('Text mit\n```js\ncode\n```\ndanach')
  })
})
