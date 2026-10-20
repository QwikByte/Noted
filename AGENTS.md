# Noted – Regeln für die Arbeit am Code

Noted ist eine selbst gehostete Notizen-App für die Uni (PWA) auf Basis von Markdown: Next.js 16 (App Router), React 19,
Tailwind CSS 4, TanStack Query, CodeMirror 6 und SQLite. Was die App kann und wie sie betrieben wird, steht in der
[README](README.md). Diese Datei legt fest, **wie** am Code gearbeitet wird – für Menschen und KI-Agenten gleichermaßen.

## 1. Zusammenarbeit

- **Bei Fragen fragen.** Ist eine Anforderung mehrdeutig oder gibt es mehrere vertretbare Lösungen mit
  unterschiedlichen Folgen, erst nachfragen statt raten. Das gilt immer bei Änderungen an
  - Architektur und Ordnerstruktur,
  - Datenbankschema und gespeicherten Formaten (inkl. der Dateiformate von Export/Import),
  - Sicherheit (Anmeldung, Rechte, CSP, Uploads),
  - Abhängigkeiten (neue npm-Pakete),
  - sichtbarem Verhalten, das über den Auftrag hinausgeht.

  Kleine, eindeutige Entscheidungen selbst treffen und im Ergebnis kurz nennen.
- **Nur das ändern, worum es geht.** Fällt nebenbei etwas auf (Fehler, toter Code, veraltete Doku), melden oder
  getrennt vorschlagen, nicht ungefragt mit umbauen.
- **Ehrlich berichten:** Was geprüft wurde, was nicht, und was fehlschlug – mit der tatsächlichen Ausgabe.

## 2. Aufbau: Package by Feature

Code wird nach **fachlichen Bereichen** gegliedert, nicht nach technischen Schichten. Alles, was zu einem Feature
gehört – Oberfläche, Browser-Logik, Server-Logik, Typen und Tests – liegt in dessen Ordner.

```
app/            Nur Routing (Next.js): Seiten und API-Routen
features/<f>/   Ein fachlicher Bereich
  components/   React-Komponenten
  client/       Logik nur für den Browser: Hooks, Stores, API-Aufrufe ('use client')
  server/       Logik nur für den Server: Datenbank, Dateisystem ('server-only')
  *.ts          Typen und reine Logik ohne Browser- oder Server-Abhängigkeit (z. B. types.ts, srs.ts)
  *.test.ts     Tests des Features
shared/         Feature-unabhängiger Code
  ui/           UI-Bausteine (Button, Modal, Toast, Seitengerüst …)
  client/       Browser-Hilfen (API-Client, Zwischenablage, lokale Einstellungen)
  server/       Server-Grundlagen (Datenbank und Migrationen, Konfiguration, HTTP, Verschlüsselung, Rate-Limits)
  markdown/     Markdown (Frontmatter, Tags, Wikilinks, Rendering, Bereinigung)
  lib/          Reine Hilfsfunktionen (Namensregeln, Formatierung)
tests/          Gemeinsame Testhelfer und Tests für scripts/
e2e/            Browser-Tests (Playwright) über mehrere Features
```

Features: `workspace` (App-Rahmen und Startseite, setzt die Features zusammen), `notes`, `mindmap`, `canvas`,
`attachments`, `flashcards`, `glossary` (Glossar und Formeln), `graph` (Graph der Wikilinks), `focus` (Fokus-Timer),
`calendar` (Kalender), `pdf`, `transfer` (Export/Import), `sharing` (Notizen per Link teilen), `auth`, `admin`,
`settings`, `updates`.

**Regeln**

1. **`app/` bleibt dünn.** Seiten und API-Routen prüfen Eingaben (zod), rufen Feature-Funktionen auf und bauen die
   Antwort. Keine Geschäftslogik und kein SQL in `app/`.
2. **`shared/` kennt keine Features.** Es importiert nie aus `features/` oder `app/` (per ESLint erzwungen). Code
   kommt erst nach `shared/`, wenn mindestens zwei Features ihn brauchen und er fachlich keinem gehört.
3. **Features importieren nicht aus `app/`** (ESLint). Was eine Route braucht, gehört ins Feature.
4. **Abhängigkeiten zwischen Features** sind erlaubt, wenn sie fachlich nötig sind (z. B. Karteikarten aus einer
   Notiz). Dann direkt das benötigte Modul importieren, die Stelle klein halten und **keine zirkulären Imports**
   zwischen Dateien erzeugen. Typen eines Features liegen in dessen `types.ts`.
5. **Neues Feature = neuer Ordner** `features/<name>/` mit den Unterordnern, die es braucht. Kein Sammelordner für
   „alles Übrige“.
6. **Server-Code** beginnt mit `import 'server-only'`, Browser-Code mit `'use client'`, damit nichts auf der falschen
   Seite landet.

**Wohin gehört …?**

| Was | Wohin |
| --- | --- |
| Neue API-Route | `app/api/…/route.ts` (dünn) + Logik in `features/<f>/server/` |
| Datenbankzugriff | `features/<f>/server/` – Schemaänderung als neue Migration in `shared/server/migrations.ts` |
| React-Komponente eines Features | `features/<f>/components/` |
| Hook oder Store mit API-Aufrufen | `features/<f>/client/` |
| Typen der API zwischen Server und Browser | `features/<f>/types.ts` |
| Grenzwert, den Server und Browser prüfen | eine Konstante im Feature (z. B. `features/flashcards/limits.ts`) |
| Allgemeiner UI-Baustein | `shared/ui/` |

## 3. Code-Stil

- **Sprache:** Oberfläche, Fehlermeldungen, Kommentare, Doku und Commit-Nachrichten auf **Deutsch**;
  Bezeichner im Code auf Englisch. Meldungen sind für Nutzer verständlich, nicht technisch.
- **Formatierung wie im Bestand:** 2 Leerzeichen, keine Semikolons, einfache Anführungszeichen, abschließende
  Kommas, Zeilen bis etwa 120 Zeichen.
- **Imports:** innerhalb eines Features (bzw. eines `shared/`-Bereichs) relativ (`./`, `../`), sonst mit `@/…`.
- **Dateinamen:** Komponenten eines Features in `PascalCase.tsx`; UI-Bausteine in `shared/ui/` und alle anderen
  Dateien in `kebab-case`.
- **TypeScript strikt:** kein `any`, keine `@ts-ignore`. Ausnahmen nur mit `eslint-disable-next-line` und Begründung.
- **Nur exportieren, was außerhalb der Datei gebraucht wird.** Kein toter Code, keine auskommentierten Blöcke,
  keine Debug-Ausgaben. Server-Fehler werden mit Präfix protokolliert: `console.error('[noted] …', err)`.
- **Keine Duplikate:** Vor einem neuen Helfer in `shared/` und im Feature nach einem vorhandenen suchen.
- **Kommentare erklären das Warum**, nicht das Was. Exportierte Funktionen mit nicht offensichtlichem Zweck bekommen
  einen kurzen `/** … */`-Kommentar.
- **Fehler auf dem Server** mit `ApiError`, `badRequest`, `notFound`, `conflict` aus `shared/server/http.ts` werfen;
  im Browser mit `errorMessage()` aus `shared/client/api.ts` anzeigen.
- **React:** Funktionskomponenten; Serverdaten über TanStack Query; lokale Einstellungen über `usePref`.
  Neue Abhängigkeiten nur nach Rückfrage (siehe 1.).

## 4. Datenbank und Sicherheit

- **Migrationen** nur am Ende von `shared/server/migrations.ts` anhängen, bestehende nie ändern.
- **Jede Abfrage filtert nach `user_id`.** Niemand sieht fremde Daten – auch der Admin nicht.
- **Jede API-Route** läuft über `route(level, handler)` aus `features/auth/server/route.ts` (CSRF-Prüfung,
  Anmeldung, Rolle). Eingaben mit `parseJson(req, zodSchema)` prüfen und in der Größe begrenzen.
- **Gerendertes HTML** aus Nutzerinhalten immer mit `sanitize()` (`shared/markdown/sanitize.ts`) bereinigen.
- Keine Geheimnisse, Tokens oder Zugangsdaten ins Repository.

## 5. Tests und Prüfungen

Vor jedem Commit müssen grün sein:

```bash
npm run lint
npm run typecheck
npm test
```

Bei Änderungen an der Oberfläche, am Service Worker oder am Build zusätzlich `npm run build && npm run test:e2e`.

- Tests liegen neben dem Code im Feature bzw. in `shared/` als `<thema>.test.ts`. API-Tests rufen die Route-Handler
  aus `app/api` direkt auf (Helfer in `tests/helpers.ts`).
- Neue Logik bekommt Tests; ein Bugfix einen Test, der den Fehler vorher zeigt.
- Tests nie abschalten, überspringen oder abschwächen, um grün zu werden.

## 6. Commits und Doku

- Commit-Nachrichten auf Deutsch: erste Zeile fasst die Änderung zusammen, darunter Was und Warum.
- README aktualisieren, wenn sich Funktionen, Konfiguration, Befehle oder der Aufbau ändern.
- Versionen und Releases (`npm version …`, siehe README) nur auf ausdrücklichen Wunsch.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
