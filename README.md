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

## Installation (Ubuntu/Debian)

Auf einem frischen Server (VPS, Raspberry Pi, Heimserver …) reicht eine Zeile:

```bash
curl -fsSL https://github.com/QwikByte/Noted/releases/latest/download/install.sh | sudo bash
```

Der Installer
- installiert Docker samt Compose (aus der offiziellen Paketquelle von Docker), falls nötig,
- lädt Noted nach `/opt/noted` und baut das neueste Release,
- richtet die [automatischen Updates](#automatische-updates) ein,
- fragt nach einer Domain und richtet auf Wunsch HTTPS mit [Caddy](https://caddyserver.com/) ein (Let's-Encrypt-Zertifikat automatisch),
- zeigt am Ende Adresse, Benutzername `admin` und das erzeugte Startpasswort an.

Ohne Rückfragen geht es mit Optionen, z. B. `… | sudo bash -s -- --domain notizen.example.com --email du@example.com` oder `--no-https`. Den Installer erneut auszuführen ist gefahrlos – so lässt sich z. B. HTTPS nachträglich einrichten.

Für HTTPS muss die Domain bereits per DNS auf den Server zeigen und die Ports 80 und 443 müssen erreichbar sein.

## Manuelle Installation mit Docker

Voraussetzungen: ein Server mit Docker und Docker Compose v2.

```bash
git clone https://github.com/QwikByte/Noted.git
cd Noted
git checkout "$(git tag --list 'v*' --sort=-v:refname | head -n 1)"   # neuestes Release
cp .env.example .env        # optional anpassen
docker compose up -d --build
docker compose logs noted   # zeigt beim ersten Start das Admin-Passwort
```

Die App läuft dann auf `http://127.0.0.1:3000`. Melde dich mit `admin` und dem Passwort aus dem Log an; danach musst du ein eigenes Passwort festlegen. Unter **Administration** legst du weitere Konten an.

Alle Daten liegen im Docker-Volume `noted-data`, gemountet unter `/data`:
- `noted.db`: SQLite-Datenbank mit Benutzern und Notizen
- `attachments/`: hochgeladene Dateien
- `secret.key`: Schlüssel für die MFA-Geheimnisse
- `backups/`: automatische Sicherungen der Datenbank vor jedem Update

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

Vor jedem Update sichert Noted die Datenbank automatisch nach `/data/backups` (die letzten 10 bleiben erhalten). Das ersetzt aber kein Backup auf einem anderen Gerät – sichere dafür das ganze Volume, zum Beispiel so:

```bash
docker run --rm -v noted-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/noted-backup-$(date +%F).tgz -C /data .
```

Zusätzlich kann jeder Benutzer unter **Einstellungen → Export & Import** jederzeit ein ZIP mit allen Notizen herunterladen.

### Automatische Updates

Der Server aktualisiert sich selbst, sobald es ein neues **Release** gibt – ein Git-Tag der Form `vX.Y.Z` (Vorabversionen wie `v1.3.0-beta` werden nicht automatisch installiert). Das übernimmt `scripts/auto-update.sh`:

1. neues Release auschecken und das Image bauen – die laufende Version bleibt währenddessen erreichbar,
2. die Datenbank sichern (`/data/backups`),
3. den Container austauschen (wenige Sekunden Unterbrechung) und warten, bis die App antwortet,
4. startet die neue Version nicht, wird automatisch zurückgerollt – auf das vorherige Image, den vorherigen Stand und, falls die neue Version die Datenbank schon umgebaut hat, auf die Sicherung. Ein solches Release wird übersprungen, bis ein neueres erscheint.

**Wann?** Stündlich (systemd-Timer `noted-update.timer`), sofort per Klick auf **Administration → System → Jetzt nach Updates suchen** oder auf dem Server mit `sudo noted-update`. Unter **Administration → System** siehst du außerdem die laufende Version, den letzten Prüfzeitpunkt, Fehler und das Protokoll des letzten Updates.

Geöffnete Apps (auch die installierte PWA auf dem Handy) merken, dass eine neue Version läuft, und zeigen **„Neue Version verfügbar – Neu laden“**. Ungespeicherte Änderungen gehen dabei nicht verloren, sie liegen ohnehin lokal und werden nach dem Neuladen weiter synchronisiert.

Nützliche Befehle auf dem Server:

```bash
sudo noted-update            # jetzt prüfen und ggf. installieren (mit Ausgabe)
sudo noted-update --check    # nur nachsehen
sudo noted-update --retry    # ein übersprungenes Release erneut versuchen
sudo noted-update --status   # letzter Stand
journalctl -u noted-update   # Protokoll des Dienstes
```

**Ohne den Installer einrichten:** Das Skript erwartet, dass es im geklonten Repository liegt (dort, wo `docker-compose.yml` liegt), und läuft als root. Am einfachsten kopierst du die drei systemd-Units aus `scripts/install.sh` (Funktion `install_update_service`) oder nimmst Cron:

```cron
0 * * * * /opt/noted/scripts/auto-update.sh
```

Mit Cron holt das Skript Klicks auf „Jetzt nach Updates suchen“ erst beim nächsten Lauf ab. Damit die App die Anfrage ablegen kann, muss der Ordner `.update/requests` dem Benutzer im Container gehören – das erledigt das Skript beim ersten Lauf (`chown 1001:1001`).

### Ein neues Release veröffentlichen

```bash
npm version patch            # bzw. minor / major – erhöht die Version, committet und setzt den Tag vX.Y.Z
git push --follow-tags
```

Eine GitHub Action legt daraufhin das Release an und hängt den Installer an. Spätestens nach einer Stunde (oder per Klick im Admin-Bereich) läuft die neue Version auf dem Server.

### Notfall: Admin ausgesperrt (z. B. Handy verloren)

Es gibt bewusst keine Wiederherstellungscodes. Normale Benutzer setzt der Admin über die Oberfläche zurück. Für den Admin selbst gibt es ein Kommandozeilen-Werkzeug im Container:

```bash
docker compose exec noted node scripts/admin-cli.mjs list
docker compose exec noted node scripts/admin-cli.mjs reset-mfa admin
docker compose exec noted node scripts/admin-cli.mjs reset-password admin
docker compose exec noted node scripts/admin-cli.mjs make-admin lisa
docker compose exec noted node scripts/admin-cli.mjs backup                # Datenbank sichern
```

Eine Sicherung zurückspielen (nur bei gestoppter App):

```bash
docker compose stop noted
docker compose run --rm noted node scripts/admin-cli.mjs restore /data/backups/noted-….db
docker compose start noted
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
| `npm run build` | Produktions-Build (`.next/standalone`); Version aus `APP_VERSION` bzw. einem Git-Tag auf dem aktuellen Commit |
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
sw/service-worker.js  Service Worker (Offline, Update-Erkennung) – public/sw.js wird beim Build daraus erzeugt
proxy.ts              Content-Security-Policy und Login-Umleitung
scripts/install.sh    Installer für Ubuntu/Debian
scripts/auto-update.sh  Automatische Updates auf dem Server (Status in .update/)
scripts/build-info.mjs  Versionsinfos für den Build (läuft vor `npm run build`)
scripts/admin-cli.mjs Notfall-Werkzeug für Admins (inkl. Sicherung/Wiederherstellung)
tests/, e2e/          Vitest- und Playwright-Tests
```
