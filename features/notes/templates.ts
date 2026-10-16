// Vorlagen für neue Notizen. Platzhalter wie in Obsidians Core-Plugin „Vorlagen“:
// {{title}}, {{date}}, {{time}}, {{date:YYYY-MM-DD}}, {{time:HH:mm}}

export type Template = {
  id: string
  name: string
  description: string
  /** Vorschlag für den Titel (Platzhalter erlaubt) */
  title: string
  content: string
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

/** Formatiert ein Datum mit Moment.js-ähnlichen Tokens (Teilmenge). */
export function formatDate(date: Date, format: string): string {
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|ss|ww|w/g, (token, literal) => {
    if (literal !== undefined) return literal
    switch (token) {
      case 'YYYY':
        return String(date.getFullYear())
      case 'YY':
        return String(date.getFullYear()).slice(-2)
      case 'MMMM':
        return MONTHS[date.getMonth()]
      case 'MMM':
        return MONTHS[date.getMonth()].slice(0, 3)
      case 'MM':
        return pad(date.getMonth() + 1)
      case 'M':
        return String(date.getMonth() + 1)
      case 'DD':
        return pad(date.getDate())
      case 'D':
        return String(date.getDate())
      case 'dddd':
        return WEEKDAYS[date.getDay()]
      case 'ddd':
        return WEEKDAYS[date.getDay()].slice(0, 2)
      case 'HH':
        return pad(date.getHours())
      case 'H':
        return String(date.getHours())
      case 'mm':
        return pad(date.getMinutes())
      case 'ss':
        return pad(date.getSeconds())
      case 'ww':
        return pad(isoWeek(date))
      case 'w':
        return String(isoWeek(date))
      default:
        return token
    }
  })
}

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

export function applyTemplate(text: string, vars: { title: string; date?: Date }): string {
  const date = vars.date ?? new Date()
  return text.replace(/\{\{\s*(title|date|time)(?::([^}]*))?\s*\}\}/g, (_m, key: string, format?: string) => {
    if (key === 'title') return vars.title
    if (key === 'date') return formatDate(date, format?.trim() || 'YYYY-MM-DD')
    return formatDate(date, format?.trim() || 'HH:mm')
  })
}

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: 'empty',
    name: 'Leere Notiz',
    description: 'Ohne Vorlage starten',
    title: 'Unbenannt',
    content: '',
  },
  {
    id: 'lecture',
    name: 'Vorlesung',
    description: 'Mitschrift mit Themen, Notizen, Fragen und Zusammenfassung',
    title: '{{date:YYYY-MM-DD}} Vorlesung',
    content: `---
tags:
  - vorlesung
kurs:
dozent:
datum: {{date:YYYY-MM-DD}}
---
## Themen
-

## Notizen


## Fragen
- [ ]

## Zusammenfassung
> [!summary] Kurz gesagt
>
`,
  },
  {
    id: 'exercise',
    name: 'Übung / Tutorium',
    description: 'Aufgaben mit Lösungsweg und offenen Punkten',
    title: '{{date:YYYY-MM-DD}} Übung',
    content: `---
tags:
  - übung
kurs:
blatt:
abgabe:
---
## Aufgabe 1
**Gegeben:**
**Gesucht:**

**Lösung:**


## Offene Fragen
- [ ]

> [!tip] Merke
>
`,
  },
  {
    id: 'cheatsheet',
    name: 'Lernzettel',
    description: 'Prüfungsvorbereitung mit Definitionen, Formeln und Karteifragen',
    title: 'Lernzettel',
    content: `---
tags:
  - lernzettel
kurs:
prüfung:
---
## Definitionen
> [!info] Begriff
> Erklärung

## Wichtige Formeln
$$
a^2 + b^2 = c^2
$$

## Beispiele


## Typische Prüfungsfragen
> [!question]- Frage
> Antwort (zum Aufklappen)

## Häufige Fehler
> [!warning]
>
`,
  },
  {
    id: 'literature',
    name: 'Literatur / Paper',
    description: 'Quelle, Kernaussagen und eigene Gedanken',
    title: '',
    content: `---
tags:
  - literatur
autor:
jahr:
quelle:
gelesen: {{date:YYYY-MM-DD}}
---
## Kernaussagen
1.

## Zitate
>

## Eigene Gedanken


## Verwandte Notizen
- [[]]
`,
  },
  {
    id: 'meeting',
    name: 'Sprechstunde / Lerngruppe',
    description: 'Teilnehmende, Besprochenes und Aufgaben',
    title: '{{date:YYYY-MM-DD}} Treffen',
    content: `---
tags:
  - treffen
datum: {{date:YYYY-MM-DD}}
teilnehmer:
---
## Besprochen
-

## Ergebnisse


## Aufgaben
- [ ]
`,
  },
]

/** Ordnernamen, deren Notizen als eigene Vorlagen angeboten werden (wie Obsidians Vorlagenordner). */
export const TEMPLATE_FOLDER_NAMES = ['vorlagen', 'templates']
