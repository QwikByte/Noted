# Noted

Notizen für die Uni – unterwegs auf dem Handy schreiben, Obsidian-kompatibel per Copy & Paste oder als Vault-Export.

Noted ist eine selbst gehostete Web-App (PWA) mit Benutzerverwaltung, Zwei-Faktor-Anmeldung und Offline-Unterstützung. Alle Notizen sind gewöhnliches Markdown im Obsidian-Format.

## Funktionen

**Notizen im Obsidian-Format**
- Editor auf Basis von CodeMirror 6, also derselben Editor-Engine, die Obsidian nutzt. Er hebt die Markdown-Syntax hervor.
- Lesemodus mit Obsidian-Darstellung:
  - `[[Wikilinks]]` mit Alias und Abschnitt (`[[Notiz#Abschnitt]]` springt zur Überschrift) sowie `![[Einbettungen]]`
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

**Fünf Formate für Notizen**
- Beim Anlegen wählst du das Format; Noted merkt sich die Wahl für die nächste Notiz.
  - **Markdown** (Standard): alles oben Beschriebene, voll Obsidian-kompatibel.
  - **Formatierter Text**: schreiben wie in Word – Überschriften, fett, kursiv, unterstrichen, Schriftgröße, Schriftfarbe, farbige Markierungen, Ausrichtung, Listen, Aufgaben, Tabellen, Links und Bilder. Gespeichert wird HTML; der Export legt solche Notizen als `.html` ab (Obsidian zeigt sie nicht als Notiz). Kopieren übernimmt die Formatierung, z. B. zum Einfügen in Word.
  - **Einfacher Text**: nur Text, nichts wird als Formatierung gelesen. Export und Download als `.md`.
  - **Mindmap**: Gedanken als Baum um ein zentrales Thema, die Hauptäste farbig abwechselnd rechts und links. Bedienung wie in Mindmap-Programmen: `Tab` legt einen Unterpunkt an, `Enter` den nächsten Punkt, Pfeiltasten wählen, `F2`, Doppelklick oder einfach lostippen bearbeitet, `Entf` löscht, `Alt+↑/↓` verschiebt, `Strg+Z` macht rückgängig. Äste lassen sich einklappen und per Drag & Drop umhängen. Auf dem Handy: Knoten antippen, nochmal antippen zum Bearbeiten, Unterpunkte über die Werkzeugleiste. Punkte können Markdown, `[[Links]]`, `#Tags`, Bilder und Aufgaben (`[ ]`) enthalten. Gespeichert wird eine Markdown-Gliederung im Format des Obsidian-Plugins [Enhancing Mindmap](https://github.com/MarkMindCkm/obsidian-enhancing-mindmap) (`mindmap-plugin: basic`, Wurzel als `#`, erste Ebene als `##`, darunter Listen) – Obsidian zeigt sie ohne Plugin als Gliederung an. In der geteilten Ansicht bearbeitest du die Gliederung als Text, die Mindmap daneben folgt.
  - **Canvas**: freie Fläche wie [Obsidian Canvas](https://obsidian.md/canvas) mit Textkarten (Markdown), eingebetteten Notizen, Bildern und PDFs, Links und Gruppen. Karten verschieben, in der Größe ändern, färben und mit Pfeilen verbinden (vom Rand einer Karte zur nächsten ziehen, Beschriftung per Doppelklick). Doppelklick auf die Fläche legt eine Karte an; Dateien lassen sich hineinziehen oder einfügen. Gespeichert im offenen Format [JSON Canvas](https://jsoncanvas.org); der Export legt `.canvas`-Dateien ab, die Obsidian direkt öffnet.
- Suche, Tags (`#tag`), Rückverweise und „Karteikarten aus Notiz“ funktionieren in allen Formaten; Wikilinks, Callouts und Formeln werden in Markdown, Mindmaps und Canvas-Karten dargestellt.
- Unter **⋮ → Format …** lässt sich das Format einer Notiz ändern. Was dabei verloren geht (z. B. Schriftfarben beim Wechsel zu Markdown), steht vor dem Umwandeln im Dialog. Aus Markdown wird eine Mindmap (Überschriften und Listen werden zu Ästen), aus einer Mindmap ein Canvas (jeder Punkt eine Karte).

**Glossar und Formelsammlung**
- Seitenleiste → **Glossar** (oder im Ordner unter **⋯ → Glossar und Formeln**): alle Definitionen und Formeln deiner Notizen auf einen Blick – z. B. als Spickzettel-Vorlage oder zum Nachschlagen vor der Klausur.
- **Begriffe** alphabetisch: Info-Callouts (`> [!info] Begriff`) und fett gedruckte Begriffe mit Erklärung (`**Begriff**: …`). **Formeln**: alle LaTeX-Blöcke (`$$…$$`), je Notiz mit der Überschrift darüber.
- Für alle Notizen oder einen Ordner samt Unterordnern, durchsuchbar; ein Klick führt an die Stelle in der Notiz. Über ⋮ als Markdown kopieren oder als `.md` herunterladen (mit Links zurück in die Notizen, in Obsidian nutzbar).
- Wird bei jedem Öffnen aus den Notizen berechnet (Markdown, Mindmaps und Canvas) und ist danach auch offline lesbar.

**Anhänge**
- Bilder (auch direkt mit der Handykamera), PDFs, Audio, Video und beliebige Dateien.
- Eingebettet wie in Obsidian: `![[Foto 2026-10-12.jpg]]`. Einfügen per Toolbar, Drag & Drop oder Strg+V.

**PDF-Viewer neben der Notiz**
- PDFs (z. B. Vorlesungsfolien) öffnen direkt in der App, ohne neues Browserfenster: Auf dem Desktop stehen PDF und Notiz nebeneinander, auf dem Handy übereinander. Den Trenner kannst du verschieben (Doppelklick: halbe-halbe); auf Wunsch füllt das PDF die ganze Fläche.
- Öffnen über den Knopf **PDF** in der Notiz (zeigt zuerst die PDFs, die in der Notiz vorkommen), per Klick auf `![[Skript.pdf]]` oder unter **Anhänge**. Neue PDFs lassen sich dort direkt hochladen; sie werden dabei in die Notiz eingebettet.
- Seiten blättern, zoomen (auch mit Strg + Mausrad oder zwei Fingern), im PDF suchen. Das PDF bleibt beim Wechseln zwischen Notizen geöffnet, Noted merkt sich die zuletzt gelesene Seite.
- **Seite verlinken** fügt `[[Skript.pdf#page=12]]` an der Cursorposition ein. Ein Klick auf so einen Link springt im Viewer auf die Seite; das Format versteht auch Obsidian.
- Markierten Text **zitieren** (als Zitat mit Seitenlink in die Notiz) oder direkt als **Karteikarte** übernehmen.
- Läuft mit [pdf.js](https://mozilla.github.io/pdf.js/) im Browser, auch offline für schon geöffnete PDFs.

**Karteikarten**
- Eigener Bereich **Karteikarten** mit Stapeln (z. B. pro Fach). Kartenarten: Grundkarte (Frage → Antwort), beidseitig (wird in beide Richtungen abgefragt), **Lückentext** und **Multiple Choice** mit einer oder mehreren richtigen Antworten und optionaler Erklärung. Karten können Markdown, LaTeX-Formeln, Bilder und Links auf Notizen oder PDF-Seiten enthalten.
- **Lernmodus mit Wiederholungsplan** (Spaced Repetition nach dem Vorbild von Anki/SM-2): Neue Karten durchlaufen kurze Lernschritte (1 und 10 Minuten), danach kommen sie in wachsenden Abständen wieder. Du bewertest mit *Nochmal*, *Schwer*, *Gut* oder *Einfach*; auf den Knöpfen steht, wann die Karte wiederkommt. Vergessene Karten werden neu gelernt. Je Stapel gibt es ein Tageslimit für neue Karten (Standard 20).
- **FSRS statt SM-2** (je Stapel unter **⋮ → Stapel bearbeiten → Wiederholungsplan**): [FSRS](https://github.com/open-spaced-repetition/fsrs4anki/wiki) schätzt für jede Karte Stabilität und Schwierigkeit und plant so, dass du dich mit der gewünschten Behaltensrate (Standard 90 %) erinnerst – meist mit weniger Wiederholungen. Bisher gelernte Karten werden aus ihrem SM-2-Stand übernommen. Noted nutzt die Standardparameter von FSRS-5; eine Optimierung auf den eigenen Lernverlauf gibt es (noch) nicht.
- **Klausurmodus:** Einen Termin im Kalender als **Klausur** markieren und die passenden Stapel auswählen (ein Stapel mit dem Namen des Termins ist vorausgewählt). Bis zur Klausur reicht kein Abstand mehr über sie hinaus: Was erst am Klausurtag oder danach fällig wäre, kommt an einem der letzten drei Tage davor dran – verteilt, nicht alles am Vortag; wer in diesen Tagen schon wiederholt hat, ist fertig. Im Stapel steht, wie viele neue Karten pro Tag nötig sind, damit bis zur Klausur alle einmal gelernt sind – als Vorschlag, der sich mit einem Klick als Tageslimit übernehmen lässt. Die Startseite zeigt einen Countdown mit dem Lernstand der verknüpften Stapel. Gespeichert bleibt der eigene Wiederholungsplan: Ab dem Klausurtag gilt er wieder. Vorgezogene Wiederholungen verlängern den Abstand (wie bei Anki) nur um die tatsächlich vergangene Zeit.
- **Übungsmodus** (z. B. kurz vor der Klausur): alle Karten in zufälliger Reihenfolge, ohne den Lernplan zu verändern. Falsch beantwortete Karten kommen wieder; am Ende siehst du deine Quote und kannst die Fehler wiederholen.
- **Lückentext:** ein Satz mit Lücken (`==Lücke==` wie im Obsidian-Plugin „Spaced Repetition“, oder `{{Lücke}}`; im Karteneditor Text auswählen und **Als Lücke**). Jede Lücke wird einzeln abgefragt, der Rest bleibt sichtbar; beim Aufdecken füllt sich die Lücke im Satz. Jede Lücke hat ihren eigenen Lernstand, neue Lücken einer Karte kommen nacheinander an verschiedenen Tagen dran.
- **Antwort eintippen** (pro Stapel unter **⋮ → Stapel bearbeiten** einschaltbar): Bei Grund- und beidseitigen Karten tippst du die Antwort ein, bevor sie aufgedeckt wird. Noted markiert die Unterschiede zur richtigen Antwort Zeichen für Zeichen; Groß- und Kleinschreibung, Leerzeichen und Satzzeichen am Ende zählen nicht, Akzente und Umlaute schon. Bewerten musst du weiterhin selbst – bei richtiger Eingabe ist *Gut* vorausgewählt, bei falscher *Nochmal*.
- **Problemkarten:** Eine Karte, die du mindestens 6-mal vergessen hast, wird markiert – meist ist sie zu umfangreich oder unklar formuliert. Im Stapel stehen alle unter dem Filter **Problemkarten**. Du kannst sie **aussetzen** (sie kommt dann beim Lernen und Üben nicht mehr dran, bis du sie fortsetzt) und nach dem Überarbeiten mit **Neu lernen** wieder von vorn beginnen.
- **Notiz abfragen** (**⋮ → Abfragen** in einer Notiz): ein Selbsttest direkt aus der Mitschrift, ohne vorher Karten anzulegen. Jede Überschrift mit Text darunter wird zur Frage, der Abschnitt ist verdeckt, bis du ihn aufdeckst und selbst bewertest. Am Ende siehst du, was du nicht wusstest – ein Klick öffnet die Notiz an dieser Stelle –, kannst es wiederholen oder als Karteikarten übernehmen. Ohne Einfluss auf den Wiederholungsplan; geht mit Markdown, formatiertem Text, Mindmaps und Canvas.
- Übersicht mit fälligen Karten (auch in der Seitenleiste), Fortschritt je Stapel (neu, lernend, gelernt, sicher), Suche in den Karten, Import ganzer Listen (`Frage::Antwort`, tabulatorgetrennt – z. B. aus Quizlet oder Anki kopiert – oder Lückentexte mit `{{…}}`).
- **Anki-Import** (Karteikarten → ⋮ → **Anki-Deck importieren**): fertige Decks als `.apkg` (auch im neuen Format ab Anki 2.1.50 und als `.colpkg`) übernehmen – Stapel und Unterstapel, Grund-, beidseitige und Lückentext-Karten, Formeln (MathJax), Bilder und Töne (als Anhänge). Auf Wunsch kommen Fälligkeiten, ausgesetzte Karten und alle bisherigen Bewertungen mit. Karten, die es im Stapel schon gibt, werden nicht doppelt angelegt.
- **Lernstatistik** (Karteikarten → **Statistik**): Lerntage als Heatmap über das letzte Jahr, Serie (Tage am Stück), Bewertungen heute, Trefferquote und Zeit pro Karte (30 Tage, auch je Stapel), eine Vorschau, wie viele Karten in den nächsten 7 bzw. 30 Tagen fällig werden, und die Lernzeit je Fach aus dem Fokus-Timer. Grundlage ist ein Protokoll aller Bewertungen – auch offline gesammelte werden beim Hochladen mitprotokolliert. Über ⋮ lässt es sich als CSV herunterladen (für Excel oder LibreOffice).
- **Mit Notizen verknüpft:** Markierten Text im Editor (Knopf in der Werkzeugleiste) oder im PDF als Karte übernehmen, oder über **⋮ → Karteikarten aus Notiz** Karten automatisch erkennen lassen: `Frage::Antwort`, `Frage:::Antwort` (beidseitig), mehrzeilig mit `?`, Multiple Choice als Aufgabenliste nach dem `?`, Frage-Callouts (`> [!question] …`), Definitionen (`> [!info] Begriff`), fett gedruckte Begriffe, Lückentexte (Absätze mit `{{Lücke}}`, auf Wunsch auch mit `==Markierungen==`) und Überschriften. Die Karten merken sich ihre Notiz; im Lesemodus siehst du unter der Notiz, wie viele Karten aus ihr stammen, und kannst sie direkt lernen.
- Lernen geht auch offline: Bewertungen werden auf dem Gerät gesammelt und später übertragen. Karten anlegen und bearbeiten braucht eine Verbindung.
- Tastatur beim Lernen: `Leertaste`/`Enter` deckt auf bzw. wählt *Gut* (nach einer falsch eingetippten Antwort *Nochmal*), `1`–`4` bewerten, bei Multiple Choice wählen `1`–`9` die Antworten. Beim Abfragen einer Notiz: `Leertaste`/`Enter` deckt auf bzw. „gewusst“, `1` „nicht gewusst“.

**Startseite und Kalender**
- Die Startseite zeigt auf einen Blick deine Termine von heute und den nächsten Tagen, die fälligen Karteikarten je Stapel (ein Klick startet das Lernen) und die nächsten Klausuren mit Countdown. Darunter stehen wie gewohnt Vorlagen, angeheftete und zuletzt bearbeitete Notizen.
- Ist heute eine Vorlesung vorbei, zu der es eine Mitschrift ohne Karteikarten gibt, schlägt die Startseite vor, Karteikarten daraus zu erstellen. Weggeklickt bleibt der Hinweis auf diesem Gerät verschwunden.
- **Eigener Kalender** (Seitenleiste → **Kalender**): Wochenansicht mit Stundenraster und Monatsansicht. Auf dem Handy zeigt die Woche einen Tag; Wischen blättert zum nächsten bzw. vorigen Tag, im Monat führt ein Tipp auf den Tag dorthin.
- Termine mit Uhrzeit oder ganztägig (auch über mehrere Tage), mit Ort, Farbe und Notizen. Einzelne Termine lassen sich als **Klausur** markieren und mit Karteikarten-Stapeln verknüpfen (siehe Klausurmodus). Ein Klick ins Raster legt einen Termin zur angeklickten Zeit an, ein Klick auf einen Termin öffnet ihn.
- **Stundenplan als Serie:** Termine wiederholen sich jede Woche oder alle 2, 3 oder 4 Wochen, auf Wunsch bis zu einem Datum (z. B. Vorlesungsende). Bei einer Serie gilt eine Änderung zunächst **nur für diesen Termin** (z. B. Raumwechsel oder eine ausfallende Vorlesung); **Alle Termine** ändert die ganze Serie.
- **Mitschrift zum Termin:** Ein Klick legt eine Notiz mit der Vorlage „Vorlesung“ an, Titel aus Datum und Termin (z. B. `2026-10-19 Analysis I`). Gibt es sie schon, öffnet der Knopf sie – auf der Startseite und im Termin.
- **Fokus starten:** Im Termin startet ein Klick den Fokus-Timer als Countdown mit der Dauer des Termins – praktisch für eingeplante Lernblöcke. Läuft der Termin schon, zählt die Restzeit.
- **.ics-Import und -Export** (Menü ⋮ im Kalender): Stundenplan aus dem Vorlesungsverzeichnis, aus Outlook oder Google einmalig übernehmen. Zeiten aus anderen Zeitzonen rechnet Noted in die Ortszeit des Geräts um. Wöchentliche Serien bleiben Serien, einzelne Ausnahmen und Änderungen werden übernommen; andere Wiederholungen (täglich, monatlich) übernimmt Noted nur mit dem ersten Termin. Ein zweiter Import derselben Datei legt nichts doppelt an. Der Export (`Kalender.ics`) lässt sich in jede Kalender-App einlesen; ob ein Termin eine Klausur ist, steht nicht darin.
- Zeiten gelten als Ortszeit – eine Vorlesung um 10:15 bleibt auch nach der Zeitumstellung um 10:15. Erinnerungen gibt es (noch) nicht. Zuletzt geladene Termine sind auch offline lesbar.

**Übungen und Klausurzulassung**
- Eigener Bereich **Übungen** (Seitenleiste): je Fach die nötige Quote für die Klausurzulassung (z. B. 50 % der Übungspunkte) und, falls bekannt, die Zahl der Blätter im Semester.
- **Übungsblätter** mit Abgabe (Tag, optional Uhrzeit), erreichbaren und – nach der Korrektur – erreichten Punkten (auch halbe und Zusatzpunkte). Ein neues Blatt übernimmt Punkte und Uhrzeit des letzten, die Abgabe eine Woche später.
- Fortschrittsbalken gegen die nötige Quote und ein Hinweis wie „Noch 14 Punkte aus 4 Blättern nötig – im Schnitt 3,5 pro Blatt“ – oder dass die Zulassung erreicht bzw. nicht mehr erreichbar ist. Fehlen noch Blätter, schätzt Noted ihre Punkte nach dem Durchschnitt der vorhandenen.
- **Abgaben im Kalender:** Jede Abgabe ist ein Termin („Abgabe Blatt 3 – Analysis I“) und steht damit im Kalender, auf der Startseite und im .ics-Export. Wird der Termin im Kalender verschoben, gilt das neue Datum; wird er dort gelöscht, hat das Blatt keine Abgabe mehr.

**Werkzeugleiste und Fokus-Timer**
- Eine kleine Werkzeugleiste sitzt fest unten rechts – auf der ganzen App (Notizen, Karteikarten, Einstellungen, Administration). Ein Klick klappt sie auf, das Kreuz wieder zu; der Zustand bleibt auf dem Gerät gespeichert.
- Werkzeuge öffnen sich als kleine Fenster, die sich am Kopf verschieben lassen. Klicks in Leiste und Fenster lassen den Cursor im Editor, du kannst also nebenher weiterschreiben.
- Leiste und Mini-Timer verdecken nichts: Sie setzen sich über die Bewertungsknöpfe beim Lernen, über „Neue Notiz“ auf dem Handy und über die Zoom-Knöpfe in Mindmap und Canvas.
- **Fokus-Timer:**
  - *Pomodoro*: 25 Minuten Fokus, 5 Minuten Pause, nach 4 Runden eine lange Pause von 15 Minuten. Alle Zeiten sind einstellbar, Fokus und Pausen wechseln automatisch.
  - *Countdown*: 5 bis 90 Minuten oder eine eigene Dauer – oder direkt aus einem Termin im Kalender mit dessen Dauer.
  - Die Einstellungen öffnest du über das Symbol im Fensterkopf neben „Schließen“.
  - Schließt du das Fenster, während der Timer läuft, bleibt er klein unten links sichtbar – am Desktop direkt neben der Seitenleiste. Ein Klick darauf öffnet ihn wieder.
  - Am Ende einer Phase gibt es einen Ton und eine Meldung. Auf Wunsch kommt zusätzlich eine Systembenachrichtigung, wenn du gerade nicht in Noted bist.
  - Der Timer läuft beim Seitenwechsel und nach dem Neuladen weiter und gilt für alle offenen Tabs. Er wird nur auf dem Gerät gespeichert, nicht auf dem Server.
  - **Lernzeit pro Fach:** Trag im Fenster ein Fach (Vorschläge aus früheren Runden und deinen Stapeln) und optional ein Ziel ein. Nach jeder Fokus-Runde bzw. jedem Countdown fragt Noted, ob die Runde zählen soll – per „Zählen“ in der Meldung oder im Fenster. Gezählte Runden landen auf dem Server (offline gesammelt und später gesendet); die **Lernstatistik** zeigt die Lernzeit je Fach der letzten vier Wochen.

**Export & Import**
- ZIP-Export aller Notizen mit Ordnerstruktur und Anhängen (Ordner `Anhänge/`). Entpacken und in Obsidian als Vault öffnen. Canvas-Karten mit Notizen und Anhängen verweisen dabei auf die Pfade im Vault.
- Karteikarten-Stapel landen im Ordner `Karteikarten/` als Markdown im Format des Obsidian-Plugins [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) (`Frage::Antwort`, `?`, Lückentexte mit `==…==`, `#flashcards/…`). Der Lernstand selbst wird nicht exportiert. Einzelne Stapel lassen sich auch über **⋮ → Als Markdown kopieren** übernehmen.
- Die Termine liegen als `Kalender.ics` im ZIP.
- Import von `.md`-Dateien (Mindmaps mit `mindmap-plugin: basic` werden als Mindmap erkannt), `.html`-Dateien (werden zu formatiertem Text), `.canvas`-Dateien, Kalendern (`.ics`, die Termine kommen in den Kalender), ZIP-Archiven (z. B. einem bestehenden Obsidian-Vault oder einem Export aus Noted) und beliebigen Dateien als Anhänge.

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
sudo bash -c "$(curl -fsSL https://github.com/QwikByte/Noted/releases/latest/download/install.sh)"
```

Der Installer
- installiert Docker samt Compose (aus der offiziellen Paketquelle von Docker), falls nötig,
- lädt Noted nach `/opt/noted` und baut das neueste Release,
- richtet die [automatischen Updates](#automatische-updates) ein,
- fragt nach einer Domain und richtet auf Wunsch HTTPS mit [Caddy](https://caddyserver.com/) ein (Let's-Encrypt-Zertifikat automatisch),
- zeigt am Ende Adresse, Benutzername `admin` und das erzeugte Startpasswort an.

Ohne Rückfragen geht es mit Optionen, z. B.:

```bash
curl -fsSL https://github.com/QwikByte/Noted/releases/latest/download/install.sh | sudo bash -s -- --domain notizen.example.com --email du@example.com
curl -fsSL https://github.com/QwikByte/Noted/releases/latest/download/install.sh | sudo bash -s -- --no-https
```

(Bei `curl … | sudo bash` stellt der Installer keine Fragen: mit `sudo-rs`, dem Standard ab Ubuntu 25.10, kommen Tastatureingaben dort nicht beim Skript an.) Den Installer erneut auszuführen ist gefahrlos. HTTPS nachträglich einrichten oder die Domain wechseln geht am einfachsten mit `sudo noted-domain` (siehe [Domain ändern](#domain-ändern)).

Für HTTPS muss die Domain bereits per DNS auf den Server zeigen und die Ports 80 und 443 müssen erreichbar sein.

Voraussetzungen: 64-Bit-System (x86_64 oder arm64, z. B. Raspberry Pi 4/5 mit 64-Bit-OS) und mindestens 1 GB Arbeitsspeicher – das Bauen braucht rund 800 MB, bei nur 1 GB ist etwas Swap empfehlenswert. Geht etwas schief, steht die komplette Ausgabe in `/var/log/noted-install.log`; der Installer lässt sich danach einfach erneut starten.

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

Noted sendet selbst eine strikte Content-Security-Policy, `X-Frame-Options: DENY` und einen HSTS-Header (ein Jahr). Prüfe deinen Server nach dem Einrichten einmal von außen, z. B. mit [SSL Labs](https://www.ssllabs.com/ssltest/) oder [Mozilla Observatory](https://observatory.mozilla.org/). Hast du weitere Subdomains, die alle HTTPS können, kannst du HSTS am Reverse Proxy verschärfen (`includeSubDomains`), z. B. in Caddy:

```caddyfile
notizen.example.com {
    header Strict-Transport-Security "max-age=63072000; includeSubDomains"
    reverse_proxy 127.0.0.1:3000
}
```

Mit nginx oder Traefik geht es genauso. Wichtig ist, dass der Proxy `X-Forwarded-For` und `X-Forwarded-Proto` setzt (bei Caddy automatisch), denn die Begrenzung von Anmeldeversuchen arbeitet mit der IP-Adresse. Erhöhe bei nginx außerdem das Upload-Limit, falls du große Dateien hochladen willst (`client_max_body_size 30m;`). Betreibe die App nicht ohne Reverse Proxy direkt im Internet.

### Domain ändern

```bash
sudo noted-domain                         # aktuelle Domain anzeigen
sudo noted-domain neu.example.com         # auf eine neue Domain umstellen
```

Der Befehl prüft zuerst, ob die neue Domain per DNS auf den Server zeigt, ersetzt dann den Noted-Eintrag in `/etc/caddy/Caddyfile` (andere Seiten dort bleiben unberührt), wartet, bis HTTPS für die neue Domain funktioniert, und setzt erst danach `APP_URL` und startet Noted neu. **Die alte Domain wird dabei abgeschaltet.** Klappt HTTPS für die neue Domain nicht (DNS noch nicht umgestellt, Ports 80/443 zu), wird die vorherige Konfiguration automatisch wiederhergestellt – Noted läuft dann unter der alten Domain weiter. Ohne Domain installiert? Derselbe Befehl richtet HTTPS nachträglich ein.

Vor dem Wechsel jedes Gerät einmal online öffnen, damit offline geschriebene Änderungen hochgeladen sind. Danach meldest du dich unter der neuen Adresse neu an (Anmeldungen gelten pro Domain) und installierst die Handy-App einmal neu. Die Authenticator-App für MFA funktioniert unverändert weiter.

Optionen: `--email ADRESSE` (Kontakt für Let's Encrypt), `--yes` (ohne Rückfrage), `--force` (ohne DNS-Prüfung und ohne Zurückrollen, z. B. wenn die Domain hinter Cloudflare liegt oder erst später umgestellt wird).

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

Eine GitHub Action legt daraufhin das Release an und hängt den Installer an. Alternativ ohne Terminal (z. B. vom Handy): auf GitHub unter **Actions → Release → Run workflow** die Version eintragen, z. B. `v1.2.0` – Tag und Release entstehen dann auf dem aktuellen Stand von `main`. Spätestens nach einer Stunde (oder per Klick im Admin-Bereich) läuft die neue Version auf dem Server.

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
- Frontend: Next.js 16 (App Router), React 19, Tailwind CSS 4, TanStack Query, CodeMirror 6, TipTap (formatierter Text), React Flow (Mindmap und Canvas), markdown-it, KaTeX, Mermaid, pdf.js
- Backend: SQLite (better-sqlite3, FTS5-Volltextsuche), @node-rs/argon2, otpauth

**Aufbau** – nach Features gegliedert (Regeln für Beiträge stehen in [`AGENTS.md`](AGENTS.md)):

```
app/                    Nur Routing: Seiten (Login, Setup, Notizen, Einstellungen, Admin) und API-Routen (app/api)
features/               Ein Ordner je fachlichem Bereich, jeweils mit components/, client/, server/ und Tests
  workspace/            App-Rahmen: Startseite, Seitenleiste, Navigation, App-Kontext, Benutzermenü, Werkzeugleiste und Fenster
  notes/                Notizen in fünf Formaten, Ordner, Tags, Suche, Papierkorb, Editoren, Vorschau, Sync, Vorlagen
  mindmap/              Mindmap: Markdown-Gliederung ↔ Baum, Anordnung, Editor
  canvas/               Canvas im Format JSON Canvas: Lesen/Schreiben, Pfade für Export, Editor mit Karten und Pfeilen
  attachments/          Anhänge: Upload, Dateiansicht, Auslieferung
  flashcards/           Karteikarten: Stapel, Karteneditor, Lernen/Üben, Wiederholungsplan, Klausurmodus, Karten ↔ Markdown, Notiz abfragen
  glossary/             Glossar und Formelsammlung aus den Notizen
  coursework/           Übungen: Fächer, Übungsblätter mit Punkten, Klausurzulassung, Abgaben als Termine
  focus/                Fokus-Timer: Pomodoro und Countdown, Ton und Benachrichtigung, gezählte Runden (Lernzeit pro Fach)
  calendar/             Kalender: Termine und wöchentliche Serien, Woche/Monat, Terminliste, .ics lesen und schreiben
  pdf/                  PDF-Viewer (pdf.js) und geteilte Ansicht
  vault/                Export und Import als Obsidian-Vault (ZIP)
  auth/                 Anmeldung, MFA, Passwörter, Sitzungen, Konten, Absicherung der API-Routen
  admin/                Benutzerverwaltung (Administration)
  settings/             Einstellungsseite
  updates/              Version, Update-Erkennung im Browser, Status der automatischen Updates
shared/                 Feature-unabhängiger Code (importiert nie aus features/)
  ui/                   Bausteine: Button, Eingabefelder, Menü, Dialog, Meldungen, Seitengerüst, Kasten, Platz für feste Leisten
  client/               API-Client, Zwischenablage, lokale Einstellungen, Media-Queries, laufende Uhrzeit
  server/               Datenbank und Migrationen, Konfiguration, HTTP-Hilfen, Verschlüsselung, Rate-Limits, Protokoll
  markdown/             Obsidian-Markdown: Frontmatter, Tags, Wikilinks, Rendering, Bereinigung
  lib/                  Namensregeln, Formatierung, HTML-Hilfen
sw/service-worker.js    Service Worker (Offline, Update-Erkennung) – public/sw.js wird beim Build daraus erzeugt
instrumentation.ts      Serverstart: Datenbank öffnen und migrieren, ersten Admin anlegen, regelmäßig aufräumen
proxy.ts                Content-Security-Policy und Login-Umleitung
scripts/install.sh      Installer für Ubuntu/Debian
scripts/auto-update.sh  Automatische Updates auf dem Server (Status in .update/)
scripts/domain.sh       Domain anzeigen/ändern (sudo noted-domain)
scripts/build-info.mjs  Versionsinfos für den Build (läuft vor `npm run build`)
scripts/vendor-pdfjs.mjs  Kopiert Worker, Schriften und Decoder von pdf.js nach public/pdfjs (vor `build` und `dev`)
scripts/admin-cli.mjs   Notfall-Werkzeug für Admins (inkl. Sicherung/Wiederherstellung)
tests/                  Testhelfer und Tests für die Skripte in scripts/
e2e/                    Browser-Tests (Playwright)
```
