import { describe, expect, it } from 'vitest'
import { answerText, compareAnswer } from './typed-answer'

describe('Antwort eintippen', () => {
  it('macht aus Karten-Markdown Klartext', () => {
    expect(answerText('**house**')).toBe('house')
    expect(answerText('*la* maison ==wichtig==')).toBe('la maison wichtig')
    expect(answerText('[[Analysis I|Analysis]] und [Link](https://example.com)')).toBe('Analysis und Link')
    expect(answerText('$E = mc^2$')).toBe('E = mc^2')
    expect(answerText('`snake_case` bleibt snake_case')).toBe('snake_case bleibt snake_case')
    expect(answerText('- erstens\n- zweitens')).toBe('erstens zweitens')
    expect(answerText('![[Bild.png]] Paris %%Kommentar%%')).toBe('Paris')
  })

  it('ignoriert Groß- und Kleinschreibung, Leerzeichen und Satzzeichen am Ende', () => {
    expect(compareAnswer('  paris ', 'Paris.').correct).toBe(true)
    expect(compareAnswer('Der   Hund!', 'der Hund').correct).toBe(true)
    expect(compareAnswer('Paris', 'Paris').parts).toEqual([{ kind: 'same', text: 'Paris' }])
  })

  it('zählt Akzente und Umlaute als Unterschied', () => {
    expect(compareAnswer('cafe', 'café').correct).toBe(false)
    expect(compareAnswer('Mueller', 'Müller').correct).toBe(false)
  })

  it('markiert falsche, überzählige und fehlende Zeichen', () => {
    expect(compareAnswer('Pariz', 'Paris')).toEqual({
      correct: false,
      parts: [
        { kind: 'same', text: 'Pari' },
        { kind: 'extra', text: 'z' },
        { kind: 'missing', text: 's' },
      ],
    })
    expect(compareAnswer('Hous', 'House').parts).toEqual([
      { kind: 'same', text: 'Hous' },
      { kind: 'missing', text: 'e' },
    ])
    expect(compareAnswer('the house', 'house').parts).toEqual([
      { kind: 'extra', text: 'the ' },
      { kind: 'same', text: 'house' },
    ])
  })

  it('vergleicht sehr lange Antworten nur noch als Ganzes', () => {
    const long = 'a'.repeat(600)
    const result = compareAnswer(long, 'b'.repeat(600))
    expect(result.correct).toBe(false)
    expect(result.parts.map((p) => p.kind)).toEqual(['extra', 'missing'])
  })
})
