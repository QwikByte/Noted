# Noted

Notizen für die Uni – unterwegs auf dem Handy schreiben, Obsidian-kompatibel per Copy & Paste oder als Vault-Export.

Noted ist eine selbst gehostete Web-App (PWA) mit Benutzerverwaltung, Zwei-Faktor-Anmeldung und Offline-Unterstützung. Alle Notizen sind gewöhnliches Markdown im Obsidian-Format.

## Funktionen

**Notizen im Obsidian-Format**
- Editor auf Basis von CodeMirror 6, also derselben Editor-Engine, die Obsidian nutzt. Er hebt die Markdown-Syntax hervor.
- Lesemodus mit Obsidian-Darstellung:
  - `[[Wikilinks]]` mit Alias und Abschnitt sowie `![[Einbettungen]]`
  - `#Tags`, auch verschachtelt (`#uni/mathe`)
  - YAML-Properties (Frontmatter)
  - Callouts (`> [!note]`, `> [!warning]-` einklappbar …)
  - LaTeX-Formeln (`$…$`, `$$…$$` via KaTeX)
  - Mermaid-Diagramme
  - Aufgaben (`- [ ]`, in der Vorschau abhakbar)
  - `==Markierungen==`, Fußnoten, Code-Hervorhebung, `%%Kommentare%%`
- Autovervollständigung für `[[Notizen]]`, `#Tags` und Callout-Typen.
- **Kopieren-Knopf**: Er kopiert das Markdown genau so, wie Obsidian es erwartet. Außerdem: ohne Properties kopieren, als `[[Wikilink]]` kopieren oder als `.md` herunterladen.
- Benennst du eine Notiz um, werden Wikilinks in anderen Notizen automatisch angepasst.
- Ordner wie in einem Vault (beliebig verschachtelt, Drag & Drop), Tags, Volltextsuche (Umlaute egal, Präfixsuche, `#tag`-Filter), Rückverweise („Verlinkt in“), Papierkorb (30 Tage), Schnellwechsler (`Strg/⌘ + K`).
- Vorlagen für Vorlesung, Übung, Lernzettel, Literatur und Sprechstunde. Eigene Vorlagen legst du als Notizen im Ordner „Vorlagen“ ab; `{{date}}`, `{{time}}` und `{{title}}` werden dabei ersetzt.

**Anhänge**
- Bilder (auch direkt mit der Handykamera), PDFs, Audio, Video und beliebige Dateien.
- Eingebettet wie in Obsidian: `![[Foto 2026-10-12.jpg]]`. Einfügen per Toolbar, Drag & Drop oder Strg+V.

**Export & Import**
- ZIP-Export aller Notizen mit Ordnerstruktur und Anhängen (Ordner `Anhänge/`). Entpacken und in Obsidian als Vault öffnen.
- Import von `.md`-Dateien, ZIP-Archiven (z. B. einem bestehenden Obsidian-Vault) und beliebigen Dateien als Anhänge.

**Unterwegs & offline (PWA)**
- Lässt sich auf Handy und Desktop installieren (im Browser „Zum Startbildschirm hinzufügen“ bzw. „App installieren“).
- Jede Änderung wird zuerst lokal auf dem Gerät gesichert und dann synchronisiert. Ohne Netz schreibst du einfach weiter, die Änderungen werden später automatisch nachgesendet.
- Die App startet auch offline. Zuletzt geladene Notizen sind lesbar.
- Bearbeitest du dieselbe Notiz auf zwei Geräten, erkennt Noted den Konflikt. Du wählst „Meine Version“, „Andere Version“ oder „Beide behalten“, es geht nichts verloren.

**Benutzer & Sicherheit**
- Keine Registrierung: Konten legt nur der Admin an, mit generiertem Startpasswort, das beim ersten Login geändert werden muss.
- Zwei-Faktor-Anmeldung per Authenticator-App (TOTP, Einrichtung per QR-Code). Der Admin kann sie pro Benutzer oder global vorschreiben.
- Admin-Bereich:
  - Benutzer anlegen, bearbeiten, deaktivieren und löschen
  - Passwort und MFA zurücksetzen, Sitzungen beenden, gesperrte Konten entsperren
  - Sicherheitsprotokoll
- Jeder sieht nur die eigenen Notizen; auch der Admin kann fremde Notizen in der Oberfläche nicht öffnen. Technisch könnte ein Admin Passwort und MFA eines Kontos zurücksetzen und sich damit anmelden. Das wird protokolliert, und der Betroffene merkt es, weil sein Passwort danach nicht mehr funktioniert.
- Weitere Schutzmaßnahmen:
  - Argon2id für Passwörter, verschlüsselt gespeicherte MFA-Schlüssel und Replay-Schutz für TOTP-Codes
  - Begrenzte Anmeldeversuche: nach 10 falschen Passwörtern wird die jeweilige IP-Adresse für dieses Konto 15 Minuten gesperrt (Fremde können dich so nicht aussperren), nach 50 Fehlversuchen insgesamt das ganze Konto
  - Nach 5 falschen MFA-Codes eine Sperre, die mit jedem weiteren Fehlversuch länger wird (bis 24 h)
  - Größenlimits für Anfragen, Uploads und ZIP-Importe
  - CSRF-Schutz, strikte Content-Security-Policy mit Nonce, HttpOnly-Cookies
  - Sitzungsübersicht mit Abmelden einzelner Geräte

## Schnellstart mit Docker

Voraussetzungen: ein Server (VPS, NAS, Raspberry Pi …) mit Docker und Docker Compose v2.

```bash
git clone https://github.com/QwikByte/Noted.git
cd Noted
cp .env.example .env        # optional anpassen
docker compose up -d --build
docker compose logs noted   # zeigt beim ersten Start das Admin-Passwort
```

Die App läuft dann auf `http://127.0.0.1:3000`. Melde dich mit `admin` und dem Passwort aus dem Log an; danach musst du ein eigenes Passwort festlegen. Unter **Administration** legst du weitere Konten an.

Alle Daten liegen im Docker-Volume `noted-data`, gemountet unter `/data`:
- `noted.db`: SQLite-Datenbank mit Benutzern und Notizen
- `attachments/`: hochgeladene Dateien
- `secret.key`: Schlüssel für die MFA-Geheimnisse

### HTTPS (wichtig)

Für die Nutzung unterwegs muss die App über HTTPS erreichbar sein. Sonst funktionieren Installation als App, Offline-Modus und Zwischenablage auf dem Handy nicht zuverlässig, und Passwörter würden unverschlüsselt übertragen. Am einfachsten geht das mit [Caddy](https://caddyserver.com/), das automatisch Let's-Encrypt-Zertifikate holt:

```caddyfile
# /etc/caddy/Caddyfile
notizen.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Setze dann in `.env` die öffentliche Adresse:

```env
APP_URL=https://notizen.example.com
```

Mit nginx oder Traefik geht es genauso. Wichtig ist, dass der Proxy `X-Forwarded-For` und `X-Forwarded-Proto` setzt (bei Caddy automatisch), denn die Begrenzung von Anmeldeversuchen arbeitet mit der IP-Adresse. Erhöhe bei nginx außerdem das Upload-Limit, falls du große Dateien hochladen willst (`client_max_body_size 30m;`). Betreibe die App nicht ohne Reverse Proxy direkt im Internet.

### Konfiguration

Alle Variablen sind optional (siehe `.env.example`):

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | Benutzername des ersten Admins (nur beim allerersten Start) |
| `ADMIN_PASSWORD` | – | Passwort des ersten Admins; ohne Angabe wird eins generiert und im Log ausgegeben |
| `APP_URL` | – | Öffentliche Adresse, z. B. `https://notizen.example.com` |
| `SECRET_KEY` | automatisch | Schlüssel für die Verschlüsselung der MFA-Geheimnisse (sonst `/data/secret.key`) |
| `APP_NAME` | `Noted` | Name in der Authenticator-App |
| `COOKIE_SECURE` | `auto` | Cookie nur über HTTPS senden (`auto` erkennt das über `X-Forwarded-Proto`) |
| `MAX_UPLOAD_MB` | `25` | Maximale Dateigröße für Anhänge |
| `MAX_IMPORT_MB` | `200` | Maximale Größe eines Imports |
| `SESSION_DAYS` | `30` | Sitzungsdauer ohne Aktivität |
| `TRASH_DAYS` | `30` | Aufbewahrung im Papierkorb |

### Backup

Sichere einfach das Volume, zum Beispiel so:

```bash
docker run --rm -v noted-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/noted-backup-$(date +%F).tgz -C /data .
```

Zusätzlich kann jeder Benutzer unter **Einstellungen → Export & Import** jederzeit ein ZIP mit allen Notizen herunterladen.

### Update

```bash
git pull
docker compose up -d --build
```

Datenbank-Migrationen laufen beim Start automatisch.

### Notfall: Admin ausgesperrt (z. B. Handy verloren)

Es gibt bewusst keine Wiederherstellungscodes. Normale Benutzer setzt der Admin über die Oberfläche zurück. Für den Admin selbst gibt es ein Kommandozeilen-Werkzeug im Container:

```bash
docker compose exec noted node scripts/admin-cli.mjs list
docker compose exec noted node scripts/admin-cli.mjs reset-mfa admin
docker compose exec noted node scripts/admin-cli.mjs reset-password admin
docker compose exec noted node scripts/admin-cli.mjs make-admin lisa
```

## Arbeiten mit Obsidian

- **Einzelne Notiz**: Klicke auf **Kopieren**, lege in Obsidian eine Notiz mit gleichem Namen an und füge den Inhalt ein. Der Titel in Noted entspricht dem Dateinamen in Obsidian.
- **Alles auf einmal**: Lade unter **Einstellungen → Export & Import** das ZIP herunter, entpacke es und öffne den Ordner in Obsidian als Vault (oder kopiere ihn in deinen bestehenden Vault). Anhänge liegen im Ordner `Anhänge/`; Obsidian findet `![[…]]`-Einbettungen dort automatisch.
- **Von Obsidian nach Noted**: Packe deinen Vault als ZIP und importiere ihn. Ordnerstruktur, Notizen und Anhänge werden übernommen, `.obsidian/` wird ignoriert.

Titel dürfen keine Zeichen enthalten, die in Dateinamen oder Obsidian-Links Probleme machen: `\ / : * ? " < > | # ^ [ ]`.

## Tastenkürzel

| Kürzel | Aktion |
| --- | --- |
| `Strg/⌘ + K` (oder `+ O`) | Schnellwechsler: Notiz suchen, öffnen oder anlegen |
| `Alt + N` | Neue Notiz |
| `Strg/⌘ + Shift + F` | Volltextsuche |
| `Strg/⌘ + S` | Sofort speichern (passiert sonst automatisch) |
| `Strg/⌘ + F` | Im Editor suchen und ersetzen |
| `Strg/⌘ + B` / `I` | Fett / kursiv |
| `Strg/⌘ + Shift + H` | ==Markieren== |

## Entwicklung

Voraussetzungen: Node.js 22+

```bash
npm install
npm run dev            # http://localhost:3000 – Admin-Passwort steht in der Konsole
```

| Befehl | Zweck |
| --- | --- |
| `npm run build` | Produktions-Build (`.next/standalone`) |
| `npm test` | Unit- und API-Tests (Vitest) |
| `npm run test:e2e` | Browser-Tests (Playwright; vorher `npm run build`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |

**Technik:**
- Frontend: Next.js 16 (App Router), React 19, Tailwind CSS 4, TanStack Query, CodeMirror 6, markdown-it, KaTeX, Mermaid
- Backend: SQLite (better-sqlite3, FTS5-Volltextsuche), @node-rs/argon2, otpauth

**Aufbau:**

```
app/                  Seiten (Login, Setup, Notizen, Einstellungen, Admin) und API-Routen (app/api)
components/           UI: app/ (Notizen), auth/, admin/, settings/, ui/ (Bausteine)
lib/server/           Datenbank, Auth, Sessions, MFA, Notizen, Anhänge, Export/Import
lib/client/           API-Client, lokale Sicherung/Sync, Markdown-Rendering, Editor
lib/shared/           Gemeinsamer Code (Obsidian-Metadaten, Namensregeln, Vorlagen, Typen)
public/sw.js          Service Worker (Offline)
proxy.ts              Content-Security-Policy und Login-Umleitung
scripts/admin-cli.mjs Notfall-Werkzeug für Admins
tests/, e2e/          Vitest- und Playwright-Tests
```
