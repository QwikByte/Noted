# Noted

Notizen für die Uni – am Laptop in der Vorlesung und unterwegs auf dem Handy.

Noted ist eine selbst gehostete Web-App (PWA) mit Benutzerverwaltung, Zwei-Faktor-Anmeldung und Offline-Unterstützung. Notizen sind gewöhnliches Markdown und lassen sich jederzeit als ZIP exportieren.

## Funktionen

**Notizen in Markdown**
- Editor auf Basis von CodeMirror 6. Er hebt die Markdown-Syntax hervor.
- Notizen in Markdown, formatiertem und einfachem Text liegen als Blatt Papier auf dem Schreibtisch – auch im dunklen Design als helles Blatt, das sich wie ein ausgedrucktes Skript liest.
- Lesemodus mit:
  - `[[Wikilinks]]` mit Alias und Abschnitt (`[[Notiz#Abschnitt]]` springt zur Überschrift) sowie `![[Einbettungen]]`
  - Titel sind nur je Ordner eindeutig: `[[Analysis/Übung 1]]` (auch `[[Uni/Analysis/Übung 1]]`) meint die „Übung 1“ im Ordner Analysis. Ohne Ordner gewinnt bei gleichnamigen Notizen die im eigenen Ordner, sonst die zuletzt bearbeitete. Passt der Ordner im Link zu keiner Notiz (z. B. nach dem Umbenennen des Ordners), zählt nur der Titel.
  - `#Tags`, auch verschachtelt (`#uni/mathe`)
  - YAML-Properties (Frontmatter)
  - Callouts (`> [!note]`, `> [!warning]-` einklappbar …)
  - LaTeX-Formeln (`$…$`, `$$…$$` via KaTeX)
  - Mermaid-Diagramme
  - Aufgaben (`- [ ]`, in der Vorschau abhakbar)
  - `==Markierungen==`, Fußnoten, Code-Hervorhebung, `%%Kommentare%%`
- Autovervollständigung für `[[Notizen]]`, `#Tags` und Callout-Typen.
- **Links im Editor:** `Strg + Klick` (Mac: `⌘ + Klick`) öffnet `[[Links]]` (auch an der Überschrift), `#Tags`, PDFs auf der Seite und Adressen, ohne in den Lesemodus zu wechseln – eine fehlende Notiz wird angelegt. Beim Überfahren zeigt eine kleine Vorschau Titel, Ordner und Anfang der Notiz. Dieselben Aktionen gibt es per Rechtsklick auf den Link. In Code, Formeln und Properties sind `[[…]]` keine Links.
- **Gliederung** (Knopf links im Kopf der Notiz): listet die Überschriften eingerückt auf; ein Klick springt im Editor und im Lesemodus dorthin, der Abschnitt, in dem du gerade liest, ist hervorgehoben. Auf breiten Bildschirmen steht sie links neben dem Blatt – ein- und ausblendbar, auf dem Gerät gemerkt –, auf schmalen Bildschirmen, im Modus „Geteilt“ und mit PDF daneben klappt sie über der Notiz auf. Mit der Tastatur: `↑`/`↓`/`Pos1`/`Ende` wandern durch die Einträge, `Enter` springt und setzt den Fokus ans Ziel, `Esc` schließt die aufgeklappte Liste. Für Markdown und formatierten Text.
- **Abschnitte einklappen:** Vor jeder Überschrift im Editor sitzt ein kleiner Pfeil (am Computer beim Überfahren der Zeile, am Handy immer). Ein Klick blendet alles bis zur nächsten Überschrift gleicher oder höherer Ebene aus, ein Klick auf den Pfeil oder auf „…“ zeigt es wieder. Per Rechtsklick gibt es „Abschnitt einklappen“, „Alle Abschnitte einklappen“ und „Alle aufklappen“, dazu Tastenkürzel (siehe unten). Ein Sprung aus der Gliederung oder ein Suchtreffer im eingeklappten Bereich klappt ihn auf, ebenso Tippen in der Überschrift. Eingeklappt ist nur für die Sitzung – der Inhalt der Notiz ändert sich nicht.
- **Tabellen bearbeiten:** In einer Tabelle springt `Tab` zur nächsten Zelle (hinter der letzten entsteht eine neue Zeile), `Umschalt + Tab` zurück – dabei werden die Spalten gleich breit aufgefüllt, die Ausrichtung (`:-:` …) bleibt. Per Rechtsklick in die Tabelle: Zeile darüber/darunter und Spalte links/rechts einfügen, Zeile oder Spalte löschen, Spalte links/zentriert/rechts ausrichten, Tabelle ausrichten. Jede Aktion lässt sich mit `Strg/⌘ + Z` in einem Schritt zurücknehmen. Ein `|` in einer Zelle schreibst du als `\|` – auch in Code und Formeln, sonst trennt es die Zelle (wie überall bei Markdown-Tabellen).
- **Befehle mit `/`:** Ein `/` am Zeilenanfang oder nach einem Leerzeichen öffnet ein Menü: Überschriften, Listen, Aufgaben, Zitat, Callout, Tabelle, Formeln, Code, Mermaid-Diagramm, Trennlinie, Wikilink, Karteikarte, Datum von heute sowie Bild oder Datei. Weitertippen filtert (`/tab`, `/h2`, `/formel`), `Enter`, Klick oder Antippen fügt ein, `Esc` schließt. In Code, Formeln, Properties und Tabellenzeilen bleibt das `/` einfach ein Zeichen. Abschaltbar unter **Einstellungen → Darstellung**.
- **Formatiert einfügen:** Aus Webseiten, Moodle oder Word Kopiertes kommt als Markdown an – Überschriften, Listen, Fettdruck, Links, Tabellen und Bilder bleiben erhalten. Eine eingefügte Adresse über markiertem Text wird zu `[Text](Adresse)`. `Strg/⌘ + Umschalt + V` fügt nur den Text ein, in Code, Formeln und Properties bleibt es immer beim Text. Abschaltbar unter **Einstellungen → Darstellung**.
- **Wortzahl und Lesezeit** (einschalten unter **Einstellungen → Darstellung**): Über der Notiz steht laufend „1.234 Wörter · ca. 6 Min. Lesezeit“ (200 Wörter pro Minute, erst ab 30 Wörtern; auf schmalen Bildschirmen nur die Wortzahl), mit Markierung im Editor „87 von 1.234 Wörtern“ – hilfreich bei Wortgrenzen für Hausarbeiten und Abstracts. Gezählt wird wie in Word der lesbare Text: „E-Mail“ und „3,14“ sind je ein Wort, Links zählen mit ihrem Text, Properties, Code, `%%Kommentare%%`, Einbettungen und Dateinamen in Links nicht. Mindmaps und Canvas zählen den Text ihrer Punkte bzw. Karten. Dieselbe Zahl steht unter **⋮ → Informationen**.
- **Sprache der Notiz:** `lang: en` (oder `en-GB`, `fr` …) in den Properties setzt die Sprache einer Markdown-Notiz – wie bei Pandoc. Auswählen lässt sie sich auch unter **⋮ → Informationen**; das schreibt bzw. entfernt die Zeile `lang:`. Alle anderen Notizen (auch formatierter und einfacher Text) nutzen die **Sprache der Notizen** unter **Einstellungen → Darstellung** (Standard: Deutsch, andere Kürzel wie `pt-BR` frei eingebbar). Editor, Lesemodus und Druck bekommen damit das passende `lang`-Attribut: Screenreader lesen englischen Text englisch vor. Ob die Rechtschreibprüfung es nutzt, hängt vom Browser ab – Firefox wählt danach das Wörterbuch (sofern installiert), Chrome und Safari richten sich eher nach den in Browser bzw. System eingestellten Sprachen.
- **Kopieren-Knopf**: Er kopiert das Markdown der Notiz. Außerdem: ohne Properties kopieren, als `[[Wikilink]]` kopieren oder als `.md` herunterladen.
- **Drucken** (**⋮ → Drucken …** oder `Strg/⌘ + P`): eine Druckansicht mit der Notiz auf hellem Blatt – auch im dunklen Design –, im Druckdialog auch „Als PDF speichern“. Formeln, Diagramme, Callouts (eingeklappte aufgeklappt), Code, Tabellen, Bilder und Fußnoten kommen mit, `%%Kommentare%%` nicht; externe Links bekommen ihre Adresse dahinter. Wählbar: Titel, Properties und **Kompakt** (kleinere Schrift, zwei Spalten – für Spickzettel). Gedruckt wird der aktuelle Stand, auch offline. Mindmaps erscheinen als Gliederung, Canvas als Text der Karten.
- Benennst du eine Notiz um, werden Wikilinks in anderen Notizen automatisch angepasst. Gibt es noch eine Notiz mit dem alten Titel, bleiben Links, die auch diese meinen können (ohne Ordner und nicht aus demselben Ordner), stehen – ein Hinweis nennt ihre Zahl.
- Ein Klick auf einen Link zu einer Notiz, die es noch nicht gibt, legt sie an – `[[Physik/Wellen]]` im Ordner „Physik“, falls es ihn gibt. Enthält das Linkziel Zeichen, die in Titeln nicht erlaubt sind (z. B. `?`), öffnet sich stattdessen „Neue Notiz“ mit einem bereinigten Titel.
- **Verlauf** (**⋮ → Verlauf …**): Ältere Stände einer Notiz ansehen und wiederherstellen. Gesichert wird beim Weiterschreiben höchstens alle 10 Minuten sowie vor jedem Formatwechsel, Überschreiben nach einem Konflikt und Wiederherstellen; aufbewahrt werden bis zu 50 Stände je Notiz für 90 Tage. **Änderungen bis heute** vergleicht einen Stand Zeile für Zeile mit dem aktuellen Inhalt – so siehst du, was beim Wiederherstellen verloren ginge (auch für formatierten Text, Mindmaps und Canvas; ein Canvas erscheint in der Vorschau als Text seiner Karten).
- **Konflikte:** Wurde eine Notiz auf einem anderen Gerät geändert, während du sie bearbeitet hast, fragt eine Leiste über dem Blatt, welche Version bleiben soll: **Meine Version**, **Andere Version** oder **Beide behalten** (deine Fassung wird dann eine eigene Notiz). **Unterschiede ansehen** zeigt vorher beide Fassungen als Vergleich – im Tresor erst nach dem Entschlüsseln im Browser.
- Ordner (beliebig verschachtelt), Tags, Volltextsuche (Umlaute egal, Präfixsuche; `"Satz von Bayes"` in Anführungszeichen sucht genau diese Wortfolge, `-wort` bzw. `-"phrase"` schließt aus, `#tag` filtert nach Tags und `-#tag` schließt sie aus; **In** beschränkt die Suche auf einen Ordner samt Unterordnern – dann ohne Dateien, weil sie keinem Ordner fest angehören; findet auch Text in PDFs und Textdateien, siehe **Dateien**; ein Klick auf einen Treffer öffnet die Notiz an der ersten Fundstelle – im Editor und im Lesemodus sind alle Fundstellen markiert, die Leiste über dem Blatt springt mit ↑/↓ zwischen ihnen, Tippen oder `Esc` entfernt die Markierung), Rückverweise („Verlinkt in“), Papierkorb (30 Tage), Schnellwechsler (`Strg/⌘ + K`).
- **Sortieren** in der Ordneransicht und bei einem Tag (Knopf **Sortieren**): nach Name (A–Z oder Z–A, „Übung 2“ vor „Übung 10“), zuletzt bearbeitet oder erstellt – jeweils neueste oder älteste zuerst. Die Wahl gilt für alle Ordner bzw. alle Tags und bleibt auf dem Gerät gemerkt; Standard ist im Ordner der Name, beim Tag „zuletzt bearbeitet“. Unterordner und die Seitenleiste bleiben alphabetisch.
- **Graph** (Seitenleiste → **Graph**): alle Notizen als Punkte, die Wikilinks als Linien – so siehst du, welche Mitschriften zusammenhängen und wo Inseln sind. Größere Punkte haben mehr Verbindungen, die Farbe zeigt den obersten Ordner. Filtern nach Ordner (samt Unterordnern) und Tag, das Suchfeld hebt Notizen hervor; ein Klick öffnet die Notiz. Mit der Tastatur: Fläche fokussieren, Pfeiltasten wählen eine Notiz (bei einer Suche nur unter den Treffern), `Enter` öffnet sie, `Escape` hebt die Auswahl auf. Ab 1 500 Notizen zeigt der Graph nur einen gefilterten Ausschnitt. Im Lesemodus steht unter „Verlinkt in“ der **lokale Graph** der Notiz (direkt verlinkt oder zwei Schritte weit).
- **Drag & Drop:** Notizen und Ordner auf einen Ordner ziehen – in der Seitenleiste, in der Ordneransicht (auf Unterordner und den Pfad darüber) und aus jeder Notizliste in die Seitenleiste. Mehrere ausgewählte Notizen ziehen gemeinsam. Mit der Maus einfach ziehen, auf Handy und Tablet lange drücken und dann ziehen. Zugeklappte Ordner öffnen sich, wenn du kurz darüber verweilst; `Esc` bricht ab, „Rückgängig“ in der Meldung macht das Verschieben rückgängig.
- **Mehrfachauswahl** in der Ordneransicht, bei einem Tag, in den Suchergebnissen, auf der Startseite und im Papierkorb: `Strg/⌘ + Klick` wählt eine Notiz aus, `Umschalt + Klick` einen Bereich, `Strg/⌘ + A` alle Notizen der Liste, `Esc` hebt die Auswahl auf. Auf Handy und Tablet (und für die Tastatur) blendet **Auswählen** Kästchen ein, dann schaltet Tippen um. Die Leiste über der Liste verschiebt, heftet an oder löst und legt in den Papierkorb – im Papierkorb stellt sie wieder her oder löscht endgültig; dieselben Aktionen gibt es per Rechtsklick auf eine ausgewählte Notiz. Höchstens 500 Notizen auf einmal. Einen neuen Tab öffnen dort Mittelklick und „In neuem Tab öffnen“.
- Vorlagen für Vorlesung, Übung, Lernzettel, Literatur und Sprechstunde. Eigene Vorlagen legst du als Notizen im Ordner „Vorlagen“ ab; `{{date}}`, `{{time}}` und `{{title}}` werden dabei ersetzt.

**Fünf Formate für Notizen**
- Beim Anlegen wählst du das Format; Noted merkt sich die Wahl für die nächste Notiz.
  - **Markdown** (Standard): alles oben Beschriebene.
  - **Formatierter Text**: schreiben wie in Word – Überschriften, fett, kursiv, unterstrichen, Schriftgröße, Schriftfarbe, farbige Markierungen, Ausrichtung, Listen, Aufgaben, Tabellen, Links und Bilder – auch hier mit Befehlen nach `/`. Gespeichert wird HTML; der Export legt solche Notizen als `.html` ab. Kopieren übernimmt die Formatierung, z. B. zum Einfügen in Word.
  - **Einfacher Text**: nur Text, nichts wird als Formatierung gelesen. Export und Download als `.md`.
  - **Mindmap**: Gedanken als Baum um ein zentrales Thema, die Hauptäste farbig abwechselnd rechts und links. Bedienung wie in Mindmap-Programmen: `Tab` legt einen Unterpunkt an, `Enter` den nächsten Punkt, Pfeiltasten wählen, `F2`, Doppelklick oder einfach lostippen bearbeitet, `Entf` löscht, `Alt+↑/↓` verschiebt, `Strg+Z` macht rückgängig. Äste lassen sich einklappen und per Drag & Drop umhängen. Auf dem Handy: Knoten antippen, nochmal antippen zum Bearbeiten, Unterpunkte über die Werkzeugleiste. Punkte können Markdown, `[[Links]]`, `#Tags`, Bilder und Aufgaben (`[ ]`) enthalten. Gespeichert wird eine Markdown-Gliederung (`mindmap-plugin: basic`, Wurzel als `#`, erste Ebene als `##`, darunter Listen) – jeder Markdown-Editor zeigt sie als Gliederung an. In der geteilten Ansicht bearbeitest du die Gliederung als Text, die Mindmap daneben folgt.
  - **Canvas**: freie Fläche mit Textkarten (Markdown), eingebetteten Notizen, Bildern und PDFs, Links und Gruppen. Karten verschieben, in der Größe ändern, färben und mit Pfeilen verbinden (vom Rand einer Karte zur nächsten ziehen, Beschriftung per Doppelklick). Doppelklick auf die Fläche legt eine Karte an; Dateien lassen sich hineinziehen oder einfügen. Mit der Tastatur: Pfeiltasten wählen Karten, `Alt+Pfeil` verschiebt (mit `Umschalt` weiter), `Strg/⌘+Pfeil` ändert die Größe, `V` verbindet (Ziel mit den Pfeiltasten wählen, `Enter`), `Enter` bearbeitet bzw. öffnet, `Entf` löscht. Gespeichert im offenen Format [JSON Canvas](https://jsoncanvas.org); der Export legt `.canvas`-Dateien ab.
- Suche, Tags (`#tag`), Rückverweise und „Karteikarten aus Notiz“ funktionieren in allen Formaten; Wikilinks, Callouts und Formeln werden in Markdown, Mindmaps und Canvas-Karten dargestellt.
- Unter **⋮ → Format …** lässt sich das Format einer Notiz ändern. Was dabei verloren geht (z. B. Schriftfarben beim Wechsel zu Markdown), steht vor dem Umwandeln im Dialog. Aus Markdown wird eine Mindmap (Überschriften und Listen werden zu Ästen), aus einer Mindmap ein Canvas (jeder Punkt eine Karte).

**Glossar und Formelsammlung**
- Seitenleiste → **Glossar** (oder im Ordner unter **⋯ → Glossar und Formeln**): alle Definitionen und Formeln deiner Notizen auf einen Blick – z. B. als Spickzettel-Vorlage oder zum Nachschlagen vor der Klausur.
- **Begriffe** alphabetisch: Info-Callouts (`> [!info] Begriff`) und fett gedruckte Begriffe mit Erklärung (`**Begriff**: …`). **Formeln**: alle LaTeX-Blöcke (`$$…$$`), je Notiz mit der Überschrift darüber.
- Für alle Notizen oder einen Ordner samt Unterordnern, durchsuchbar; ein Klick führt an die Stelle in der Notiz. Über ⋮ als Markdown kopieren oder als `.md` herunterladen (mit Links zurück in die Notizen) oder **drucken** – was gerade zu sehen ist (Ordner und Suche), wahlweise nur Begriffe oder Formeln, mit oder ohne Fundstellen, auf Wunsch kompakt in zwei Spalten.
- Wird bei jedem Öffnen aus den Notizen berechnet (Markdown, Mindmaps und Canvas) und ist danach auch offline lesbar.

**Dateien**
- Bilder (auch direkt mit der Handykamera), PDFs, Audio, Video und beliebige Dateien.
- Eingebettet mit `![[Foto 2026-10-12.jpg]]`. Einfügen per Toolbar, Drag & Drop oder Strg+V.
- Der Bereich **Dateien** zeigt sie in der Ordnerstruktur deiner Notizen: Jede Datei steht im Ordner der Notiz, die sie einbettet oder verlinkt – nutzen mehrere Notizen sie, in jedem dieser Ordner. Verschiebst du die Notiz, wandert die Datei mit. Ordner legst und verschiebst du nur bei den Notizen. Dateien, die in keiner Notiz vorkommen (z. B. aus dem Anki-Import), stehen unter **Ohne Notiz**. Bilder erscheinen als Vorschau, PDFs mit ihrer ersten Seite (einmal im Browser erzeugt und dort aufbewahrt).
- **Durchsuchbar:** Die Volltextsuche findet auch Text in hochgeladenen PDFs (mit Seitenzahl – ein Klick öffnet das PDF auf der Seite, mit offener Suche und den Suchwörtern hervorgehoben) sowie in `.txt`-, `.md`- und `.csv`-Dateien. Der Text wird nach dem Hochladen im Hintergrund gelesen, bei PDFs höchstens 400 Seiten und 2 MB Text. Gescannte PDFs ohne Textebene lassen sich nicht durchsuchen (keine Texterkennung); unter **Dateien** steht bei jeder Datei, ob sie durchsuchbar ist.

**PDF-Viewer neben der Notiz**
- PDFs (z. B. Vorlesungsfolien) öffnen direkt in der App, ohne neues Browserfenster: Auf dem Desktop stehen PDF und Notiz nebeneinander, auf dem Handy übereinander. Den Trenner kannst du verschieben (Doppelklick: halbe-halbe); auf Wunsch füllt das PDF die ganze Fläche.
- Öffnen über den Knopf **PDF** in der Notiz (zeigt zuerst die PDFs, die in der Notiz vorkommen), per Klick auf `![[Skript.pdf]]` oder unter **Dateien**. Neue PDFs lassen sich dort direkt hochladen; sie werden dabei in die Notiz eingebettet.
- Seiten blättern, zoomen (auch mit Strg + Mausrad oder zwei Fingern), im PDF suchen – auf Wunsch mit Groß-/Kleinschreibung oder nur ganze Wörter.
- **Tastatur** (Fokus im PDF): `Strg/⌘ + F` sucht, `F3`/`Umschalt + F3` springt zum nächsten/vorigen Treffer, `←`/`→` blättert, `Pos1`/`Ende` springt zur ersten/letzten Seite, `+`/`-` zoomt, `0` passt die Seitenbreite ein, `G` setzt den Cursor ins Seitenfeld, `Strg/⌘ + Umschalt + H` markiert die Auswahl, `Esc` schließt Suche bzw. Markierung. Das PDF bleibt beim Wechseln zwischen Notizen geöffnet, Noted merkt sich die zuletzt gelesene Seite.
- **Seite verlinken** fügt `[[Skript.pdf#page=12]]` an der Cursorposition ein. Ein Klick auf so einen Link springt im Viewer auf die Seite.
- Ausgewählten Text **als Zitat einfügen** (mit Seitenlink in die Notiz) oder direkt als **Karteikarte** übernehmen. Die Auswahl darf über eine Seitengrenze gehen; der Seitenlink zeigt dann auf die erste Seite, markiert wird auf jeder Seite.
- **Anmerkungen:** Ausgewählten Text **markieren** oder **kommentieren** – wie mit einem Textmarker, in sechs Farben. Ein Klick auf eine Markierung öffnet Kommentar, Farbe, **Als Zitat einfügen** und Löschen. Die Seitenleiste **Anmerkungen** (Textmarker-Knopf oben) listet alle Markierungen des PDFs nach Seite; ein Klick springt zur Stelle, **Alle als Zitate einfügen** übernimmt sie mit Seitenlinks in die Notiz. Markierungen liegen auf dem Server (auf jedem Gerät an derselben Textstelle, auch nach dem Zoomen) und entstehen auch offline – sie werden gesendet, sobald wieder Verbindung besteht. Gescannte PDFs ohne Textebene lassen sich nicht markieren.
- **Mit Markierungen herunterladen** (⋮ im Viewer): ein PDF, in dem die Markierungen als echte PDF-Anmerkungen stecken – in derselben Farbe an derselben Textstelle, Kommentare als Notiz. So lassen sie sich in anderen PDF-Readern lesen, ausdrucken oder weitergeben. Das PDF entsteht im Browser; die Datei auf dem Server und die Markierungen in Noted bleiben unverändert.
- Läuft mit [pdf.js](https://mozilla.github.io/pdf.js/) im Browser, auch offline für schon geöffnete PDFs – auch nach einem Update der App: Noted lädt den Viewer dann im Hintergrund vorab, sobald es PDFs gibt. Ein PDF, das auf dem Gerät noch nie geöffnet wurde, geht offline nicht; Noted sagt das, statt eine technische Meldung zu zeigen.

**Karteikarten**
- Eigener Bereich **Karteikarten** mit Stapeln (z. B. pro Fach). Kartenarten: Grundkarte (Frage → Antwort), beidseitig (wird in beide Richtungen abgefragt), **Lückentext**, **Multiple Choice** mit einer oder mehreren richtigen Antworten und optionaler Erklärung sowie **Bildverdeckung**. Karten können Markdown, LaTeX-Formeln, Bilder und Links auf Notizen oder PDF-Seiten enthalten. Bilder und andere Dateien kommen per Einfügen (`Strg/⌘ + V`, z. B. ein Screenshot einer Folie) oder Hineinziehen direkt in Vorder- und Rückseite; sie landen unter **Dateien** und werden an der Cursorposition eingebettet.
- **Lernmodus mit Wiederholungsplan** (Spaced Repetition nach dem Vorbild von Anki/SM-2): Neue Karten durchlaufen kurze Lernschritte (1 und 10 Minuten), danach kommen sie in wachsenden Abständen wieder. Du bewertest mit *Nochmal*, *Schwer*, *Gut* oder *Einfach*; auf den Knöpfen steht, wann die Karte wiederkommt. Vergessene Karten werden neu gelernt. Abstände ab drei Tagen werden wie bei Anki leicht gestreut (etwa ±15 % bei einer Woche, ±5 % bei langen Abständen): So kommen Karten, die du gemeinsam gelernt hast, nicht für immer am selben Tag wieder. Der Abstand auf dem Knopf ist genau der, der geplant wird – mit SM-2 wie mit FSRS. Je Stapel gibt es ein Tageslimit für neue Karten (Standard 20). Seiten derselben Karte – Lücken, Flächen einer Bildverdeckung, Vorder- und Rückseite – kommen an verschiedenen Tagen dran, damit sich nicht eine aus der anderen ergibt; nur am Tag vor einer Klausur kommt alles Fällige.
- **FSRS statt SM-2** (je Stapel unter **⋮ → Stapel bearbeiten → Wiederholungsplan**): [FSRS](https://github.com/open-spaced-repetition/fsrs4anki/wiki) schätzt für jede Karte Stabilität und Schwierigkeit und plant so, dass du dich mit der gewünschten Behaltensrate (Standard 90 %) erinnerst – meist mit weniger Wiederholungen. Bisher gelernte Karten werden aus ihrem SM-2-Stand übernommen. Zu Beginn gelten die Standardparameter von FSRS-5. Unter **Lernstatistik → Parameter optimieren** schätzt Noted die 19 Gewichte aus deinem Bewertungsprotokoll (wie der Optimierer von Anki) – lohnt sich ab einigen Hundert Wiederholungen, danach etwa einmal im Monat. Die Parameter gelten für alle Stapel mit FSRS und werden nur übernommen, wenn sie deine Wiederholungen besser vorhersagen als die bisherigen; **Standardwerte** stellt den Ausgangszustand wieder her. Der Lernstand der Karten bleibt dabei, wie er ist – die neuen Gewichte wirken ab der nächsten Bewertung.
- **Klausurmodus:** Einen Termin im Kalender als **Klausur** markieren und die passenden Stapel auswählen (ein Stapel mit dem Namen des Termins ist vorausgewählt). Bis zur Klausur reicht kein Abstand mehr über sie hinaus: Was erst am Klausurtag oder danach fällig wäre, kommt an einem der letzten drei Tage davor dran – verteilt, nicht alles am Vortag; wer in diesen Tagen schon wiederholt hat, ist fertig. Im Stapel steht, wie viele neue Karten pro Tag nötig sind, damit bis zur Klausur alle einmal gelernt sind – als Vorschlag, der sich mit einem Klick als Tageslimit übernehmen lässt. Die Startseite zeigt einen Countdown mit dem Lernstand der verknüpften Stapel. Gespeichert bleibt der eigene Wiederholungsplan: Ab dem Klausurtag gilt er wieder. Vorgezogene Wiederholungen verlängern den Abstand (wie bei Anki) nur um die tatsächlich vergangene Zeit.
- **Übungsmodus** (z. B. kurz vor der Klausur): alle Karten in zufälliger Reihenfolge, ohne den Lernplan zu verändern. Falsch beantwortete Karten kommen wieder; am Ende siehst du deine Quote und kannst die Fehler wiederholen. Das Menü am Knopf **Üben** (im Stapel und auf jeder Kachel) bietet außerdem eigene Übungen: **Heute vergessen** (heute mit „Nochmal“ bewertet – ohne Verbindung nur die Bewertungen dieses Geräts), **Problemkarten** und die **Schwersten 50** (höchste FSRS-Schwierigkeit bzw. niedrigste Leichtigkeit, bei Gleichstand die öfter vergessenen). Auch sie verändern den Lernplan nicht und lassen sich neu laden.
- **Lückentext:** ein Satz mit Lücken (`==Lücke==` oder `{{Lücke}}`; im Karteneditor Text auswählen und **Als Lücke**). Jede Lücke wird einzeln abgefragt, der Rest bleibt sichtbar; beim Aufdecken füllt sich die Lücke im Satz. Jede Lücke hat ihren eigenen Lernstand, neue Lücken einer Karte kommen nacheinander an verschiedenen Tagen dran. Beim Bearbeiten bleibt der Lernstand bei seiner Lücke: Kommt eine dazu, wird eine gelöscht, umgestellt oder umformuliert, behalten die übrigen ihren Stand.
- **Bildverdeckung** (Image Occlusion): Diagramme, Anatomie-Abbildungen oder Schaltpläne lernen, indem Beschriftungen verdeckt werden. Im Karteneditor ein Bild hochladen, aus den Dateien wählen oder eine PDF-Seite als Bild übernehmen (auch im PDF-Viewer unter ⋮ → **Seite als Bildverdeckung**) und Rechtecke über die Beschriftungen ziehen – mit Maus, Stift oder Finger; Flächen lassen sich verschieben, an der Ecke vergrößern und optional beschriften. Ohne Maus: **Fläche hinzufügen**, dann verschieben die Pfeiltasten die gewählte Fläche (mit `Umschalt` weiter), `Alt+Pfeil` ändert die Größe, `.` und `,` wechseln zur nächsten bzw. vorigen Fläche, `Entf` löscht. Jede Fläche wird einzeln abgefragt und hat ihren eigenen Lernstand – er bleibt bei der Fläche, auch wenn andere hinzukommen oder gelöscht werden. Wählbar je Karte: nur die abgefragte Fläche verdeckt oder alle. Mit beschrifteten Flächen funktioniert auch **Antwort eintippen**.
- **Antwort eintippen** (pro Stapel unter **⋮ → Stapel bearbeiten** einschaltbar): Bei Grund- und beidseitigen Karten tippst du die Antwort ein, bevor sie aufgedeckt wird. Noted markiert die Unterschiede zur richtigen Antwort Zeichen für Zeichen; Groß- und Kleinschreibung, Leerzeichen und Satzzeichen am Ende zählen nicht, Akzente und Umlaute schon. Bewerten musst du weiterhin selbst – bei richtiger Eingabe ist *Gut* vorausgewählt, bei falscher *Nochmal*.
- **Problemkarten:** Eine Karte, die du mindestens 6-mal vergessen hast, wird markiert – meist ist sie zu umfangreich oder unklar formuliert. Im Stapel stehen alle unter dem Filter **Problemkarten**. Du kannst sie **aussetzen** (sie kommt dann beim Lernen und Üben nicht mehr dran, bis du sie fortsetzt) und nach dem Überarbeiten mit **Neu lernen** wieder von vorn beginnen. Aussetzen und Neu lernen gehen auch bei jeder anderen Karte: im Stapel über **⋮** an der Karte oder per Rechtsklick, beim Lernen über **Karte aussetzen** im Kopf – die Sitzung geht dann mit der nächsten Karte weiter.
- **Notiz abfragen** (**⋮ → Abfragen** in einer Notiz): ein Selbsttest direkt aus der Mitschrift, ohne vorher Karten anzulegen. Jede Überschrift mit Text darunter wird zur Frage, der Abschnitt ist verdeckt, bis du ihn aufdeckst und selbst bewertest. Am Ende siehst du, was du nicht wusstest – ein Klick öffnet die Notiz an dieser Stelle –, kannst es wiederholen oder als Karteikarten übernehmen. Ohne Einfluss auf den Wiederholungsplan; geht mit Markdown, formatiertem Text, Mindmaps und Canvas.
- Übersicht mit fälligen Karten (auch in der Seitenleiste), Fortschritt je Stapel (neu, lernend, gelernt, sicher), Suche in den Karten, Import ganzer Listen (`Frage::Antwort`, tabulatorgetrennt – z. B. aus Quizlet oder Anki kopiert – oder Lückentexte mit `{{…}}`).
- **Stapel drucken** (Stapel → ⋮ → **Drucken …** oder `Strg/⌘ + P`): die Karten als nummerierte Liste, mit Suche und Filter so, wie sie im Stapel stehen. Ohne **Antworten** wird daraus ein Fragebogen zum Abfragen auf Papier – Lücken erscheinen als „[…]“, bei Multiple Choice fehlt das „✓“, Bildverdeckungen sind ganz verdeckt.
- **Stapel weitergeben** (Stapel → ⋮ → **Als Datei exportieren**): eine `.noted-deck.zip` mit allen Karten (alle Kartenarten, Antworten, Lückentexte, Bildverdeckungen), den verwendeten Bildern und den Einstellungen des Stapels – ohne Lernstand. Importieren lässt sie sich in jedem Noted-Konto über Karteikarten → ⋮ → **Stapel importieren** (als neuer Stapel oder in einen bestehenden) oder über den allgemeinen Import. Karten, die es im Stapel schon gibt, kommen nicht doppelt.
- **Anki-Import** (Karteikarten → ⋮ → **Anki-Deck importieren**): fertige Decks als `.apkg` (auch im neuen Format ab Anki 2.1.50 und als `.colpkg`) übernehmen – Stapel und Unterstapel, Grund-, beidseitige und Lückentext-Karten, Formeln (MathJax), Bilder und Töne (unter **Dateien**). Auf Wunsch kommen Fälligkeiten, ausgesetzte Karten und alle bisherigen Bewertungen mit. Karten, die es im Stapel schon gibt, werden nicht doppelt angelegt.
- **Lernstatistik** (Karteikarten → **Statistik**): Lerntage als Heatmap über das letzte Jahr, Serie (Tage am Stück), Bewertungen heute, Trefferquote und Zeit pro Karte (30 Tage, auch je Stapel), eine Vorschau, wie viele Karten in den nächsten 7 bzw. 30 Tagen fällig werden (vor einer Klausur mit den vorgezogenen Wiederholungen), und die Lernzeit je Fach aus dem Fokus-Timer, außerdem die FSRS-Parameter (optimieren und wie gut sie vorhersagen). Grundlage ist ein Protokoll aller Bewertungen – auch offline gesammelte werden beim Hochladen mitprotokolliert. Über ⋮ lässt es sich als CSV herunterladen (für Excel oder LibreOffice).
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

**Werkzeugleiste, Fokus-Timer und Schmierzettel**
- Ein schmaler Griff sitzt mittig am rechten Bildschirmrand – auf der ganzen App (Notizen, Karteikarten, Einstellungen, Administration). Ein Klick klappt die Werkzeugleiste auf, der Pfeil wieder zu; der Zustand bleibt auf dem Gerät gespeichert.
- Werkzeuge öffnen sich als kleine Fenster, die sich am Kopf verschieben lassen. Klicks auf Knöpfe in Leiste und Fenster lassen den Cursor im Editor, du kannst also nebenher weiterschreiben.
- Der Mini-Timer verdeckt nichts: Er setzt sich über die Bewertungsknöpfe beim Lernen und steht neben der Seitenleiste.
- **Fokus-Timer:**
  - *Pomodoro*: 25 Minuten Fokus, 5 Minuten Pause, nach 4 Runden eine lange Pause von 15 Minuten. Alle Zeiten sind einstellbar, Fokus und Pausen wechseln automatisch.
  - *Countdown*: 5 bis 90 Minuten oder eine eigene Dauer – oder direkt aus einem Termin im Kalender mit dessen Dauer.
  - Die Einstellungen öffnest du über das Symbol im Fensterkopf neben „Schließen“.
  - Schließt du das Fenster, während der Timer läuft, bleibt er klein unten links sichtbar – am Desktop direkt neben der Seitenleiste. Ein Klick darauf öffnet ihn wieder.
  - Am Ende einer Phase gibt es einen Ton und eine Meldung. Auf Wunsch kommt zusätzlich eine Systembenachrichtigung, wenn du gerade nicht in Noted bist.
  - Der Timer läuft beim Seitenwechsel und nach dem Neuladen weiter und gilt für alle offenen Tabs. Er wird nur auf dem Gerät gespeichert, nicht auf dem Server.
  - **Lernzeit pro Fach:** Trag im Fenster ein Fach (Vorschläge aus früheren Runden und deinen Stapeln) und optional ein Ziel ein. Nach jeder Fokus-Runde bzw. jedem Countdown fragt Noted, ob die Runde zählen soll – per „Zählen“ in der Meldung oder im Fenster. Gezählte Runden landen auf dem Server (offline gesammelt und später gesendet); die **Lernstatistik** zeigt die Lernzeit je Fach der letzten vier Wochen.
- **Schmierzettel** (`Alt + J`, auch bei eingeklappter Leiste): ein Textfeld für alles, was nebenbei anfällt – Telefonnummer, Rechnung, Raumänderung, Idee in der Vorlesung. Ein Zettel je Konto, auf allen Geräten derselbe und offline nutzbar (gespeichert wird zuerst auf dem Gerät, dann auf dem Server; haben zwei Geräte gleichzeitig geändert, stehen danach beide Änderungen darin). Er zählt nicht als Notiz: Suche, Tags, Graph, Rückverweise und Export sehen ihn nicht. Höchstens 20 000 Zeichen.
  - **In offene Notiz einfügen** setzt den Text als eigenen Absatz an die Cursorposition (im Lesemodus ans Ende; in einer Mindmap wird jede Zeile ein Unterpunkt, im Canvas eine Textkarte). **Als neue Notiz** legt eine Markdown-Notiz an, deren Titel aus der ersten Zeile kommt – die Ansicht bleibt, „Öffnen“ in der Meldung führt hin. **Leeren** leert ihn. Danach ist der Zettel leer; Einfügen und Leeren lassen sich über die Meldung zurückholen.
  - `Alt + J` setzt den Cursor ins Textfeld, `Esc` schließt den Zettel und springt zurück an die vorherige Stelle im Editor.

**Tresor (Ende-zu-Ende verschlüsselt)**

Notizen im Tresor werden in deinem Browser verschlüsselt, bevor sie den Server erreichen. Ohne dein Tresor-Passwort kann sie niemand lesen – auch nicht der Admin oder wer eine Sicherung der Datenbank hat. Vergisst du Passwort und Wiederherstellungsschlüssel, sind sie verloren. Nicht geschützt bist du, wenn der Server absichtlich verändert wurde oder dein Gerät Schadsoftware hat. Suche, Tags, Rückverweise, Teilen und Karteikarten funktionieren im Tresor nicht.

- **Einrichten** unter **Einstellungen → Tresor**: ein eigenes Tresor-Passwort (mindestens 12 Zeichen, am besten ein Satz aus mehreren Wörtern – nicht dein Anmeldepasswort) und ein **Wiederherstellungsschlüssel** (32 Zeichen in 8 Gruppen) zum Drucken, Speichern oder Kopieren, den du zur Kontrolle einmal teilweise eintippst. Danach gibt es in den Notizen den Ordner **Tresor** mit Schloss; darin lassen sich Unterordner und Notizen in allen Formaten anlegen.
- **Entsperren** per Klick auf „Tresor“ in der Seitenleiste. Entsperrt ist nur der eine Tab: Der Schlüssel liegt nur in dessen Arbeitsspeicher, Neuladen und Abmelden sperren. **Sperren** geht über das Schloss neben „Tresor“ und im Benutzermenü und wirkt in allen Tabs; außerdem sperrt der Tab nach 5, 15 oder 60 Minuten ohne Eingabe (**Einstellungen → Tresor**, je Gerät, Standard 15). Gesperrt sind Tresor-Notizen nirgends zu sehen, im Papierkorb stehen sie als „Gesperrte Notiz“.
- **Passwort vergessen?** Im Entsperren-Dialog mit dem Wiederherstellungsschlüssel öffnen (Groß-/Kleinschreibung und Bindestriche sind egal) und ein neues Passwort festlegen. Passwort ändern und einen neuen Wiederherstellungsschlüssel erzeugen geht unter **Einstellungen → Tresor** – dabei wird nur der Schlüssel neu verpackt, keine Notiz neu verschlüsselt. Sind Passwort und Wiederherstellungsschlüssel weg, hilft nur **Tresor löschen …** (Bestätigung durch Eintippen, geht ohne Passwort).
- **Verschlüsselt** werden Titel, Inhalt, die Namen der Unterordner und der Verlauf (AES-GCM mit 256 Bit; der Schlüssel aus dem Passwort per PBKDF2-SHA-256 mit 600 000 Iterationen, alles mit WebCrypto im Browser). Unverschlüsselt bleiben Format, „angeheftet“, Zeitpunkte, Version, die Ordnerstruktur (ohne Namen) und der Name „Tresor“. Eine veränderte oder vertauschte Notiz wird erkannt und nicht geöffnet.
- **Was im Tresor nicht geht:** Volltextsuche, Tags (sie werden angezeigt, aber nicht gesammelt), Rückverweise, Graph, Glossar, Teilen, Karteikarten aus der Notiz, Abfragen und Dateien hochladen (Bilder und PDFs wären unverschlüsselt). Wikilinks aus dem Tresor finden alle Notizen, normale Notizen sehen Tresor-Notizen nicht; beim Umbenennen werden Links aus dem Tresor nicht angepasst. Schnellwechsler, Verlauf, Formatwechsel und Vorlagen (eingebaute und normale) funktionieren. Was du kopierst, herunterlädst oder druckst, ist Klartext.
- **Verschieben** in den Tresor und heraus geht nur Notiz für Notiz über **⋮ → In den Tresor verschieben …** bzw. **Aus dem Tresor verschieben …** (auch beim Ziehen über die Grenze). Hinein werden Verlauf, geteilte Links, Tags und Verweise der Notiz gelöscht; Karteikarten aus ihr bleiben unverschlüsselt im Stapel, wenn du sie nicht mitlöschst. Der bisherige Klartext steckt aber noch in Sicherungen, früheren Exporten und auf anderen Geräten, bis sie wieder online waren – Geheimes deshalb direkt im Tresor anlegen. Heraus ist die Notiz wieder unverschlüsselt und durchsuchbar. Ordner lassen sich nicht über die Grenze verschieben.
- **Offline** lassen sich Tresor-Notizen entsperren und bearbeiten; auf dem Gerät liegt dabei nur Verschlüsseltes. Rechtschreibprüfung ist im Tresor aus (manche Browser schicken den Text dafür an einen Dienst).
- **Grenzen:** Wer den Server kontrolliert, kann verändertes JavaScript ausliefern, das beim nächsten Entsperren Passwort oder Inhalte abgreift – das lässt sich bei einer Web-App nicht verhindern. Ebenso wenig schützt der Tresor vor Schadsoftware oder Browser-Erweiterungen, einem entsperrten Tresor auf einem fremden Gerät und einem schwachen Passwort: Wer die Datenbank hat, kann beliebig oft raten. Sichtbar bleibt, dass es einen Tresor gibt, wie viele Notizen er ungefähr wie groß enthält und wann sie geändert wurden. Nach dem Sperren hält die App keine Verweise mehr auf Entschlüsseltes; gezielt aus dem Arbeitsspeicher löschen kann JavaScript es nicht.

**Export & Import**
- ZIP-Export aller Notizen mit Ordnerstruktur und Dateien (Ordner `Anhänge/`). Canvas-Karten mit Notizen und Dateien verweisen dabei auf die Pfade im ZIP.
- Anmerkungen eines PDFs liegen daneben als lesbare Markdown-Datei (`Anhänge/Skript.pdf.anmerkungen.md`: Seite, Zitat, Kommentar). Beim Import eines Exports werden sie übersprungen.
- Karteikarten-Stapel landen im Ordner `Karteikarten/` als Markdown (`Frage::Antwort`, `?`, Lückentexte mit `==…==`, `#flashcards/…`) – „Karteikarten aus Notiz“ erkennt sie wieder. Für Bildverdeckung gibt es kein Markdown-Format: Sie wird als Titel, Bild und die Beschriftungen als Lücken exportiert. Der Lernstand selbst wird nicht exportiert. Einzelne Stapel lassen sich auch über **⋮ → Als Markdown kopieren** übernehmen. Daneben liegt jeder Stapel als verlustfreie `.noted-deck.zip`; beim Import zählt dann nur sie, damit keine Notiz aus der `.md` entsteht.
- Die Termine liegen als `Kalender.ics` im ZIP.
- Der Schmierzettel gehört nicht zum Export.
- Der Tresor liegt nur verschlüsselt im ZIP, als `Tresor.noted-vault`: JSON mit `format: "noted-vault"`, `version: 1`, den Parametern der Schlüsselableitung (`kdf`), den verpackten Schlüsseln (Passwort und Wiederherstellungsschlüssel) sowie Ordnern und Notizen (ohne Papierkorb) als verschlüsselte Umschläge (`nv1.…`). So bleibt der Export ein vollständiges Backup. Importieren lässt sich die Datei noch nicht – der Import überspringt sie mit Hinweis, und in den Tresor lässt sich nichts importieren.
- Import von `.md`-Dateien (Mindmaps mit `mindmap-plugin: basic` werden als Mindmap erkannt), `.html`-Dateien (werden zu formatiertem Text), `.canvas`-Dateien, Kalendern (`.ics`, die Termine kommen in den Kalender), Karteikarten-Stapeln (`.noted-deck.zip`), ZIP-Archiven (z. B. einem Export aus Noted oder einem Ordner mit Markdown-Dateien) und beliebigen Dateien (kommen unter **Dateien**).

**Unterwegs & offline (PWA)**
- Lässt sich auf Handy und Desktop installieren (im Browser „Zum Startbildschirm hinzufügen“ bzw. „App installieren“).
- Jede Änderung wird zuerst lokal auf dem Gerät gesichert und dann synchronisiert. Ohne Netz schreibst du einfach weiter, die Änderungen werden später automatisch nachgesendet. Sind beim Abmelden noch Notizen, der Schmierzettel oder PDF-Anmerkungen nicht gesendet, fragt Noted vorher nach.
- Die App startet auch offline. Zuletzt geladene Notizen sind lesbar – auch die im Tresor, nach dem Entsperren (auf dem Gerät liegen sie nur verschlüsselt). PDFs gehen offline, wenn sie auf dem Gerät einmal geöffnet wurden.
- Bearbeitest du dieselbe Notiz auf zwei Geräten, erkennt Noted den Konflikt. Du wählst „Meine Version“, „Andere Version“ oder „Beide behalten“, es geht nichts verloren.

**Benutzer & Sicherheit**
- Keine Registrierung: Konten legt nur der Admin an, mit generiertem Startpasswort, das beim ersten Login geändert werden muss.
- Zwei-Faktor-Anmeldung per Authenticator-App (TOTP, Einrichtung per QR-Code). Der Admin kann sie pro Benutzer oder global vorschreiben.
- Admin-Bereich:
  - Benutzer anlegen, bearbeiten, deaktivieren und löschen
  - Passwort und MFA zurücksetzen, Sitzungen beenden, gesperrte Konten entsperren
  - Sicherheitsprotokoll
- Jeder sieht nur die eigenen Notizen; auch der Admin kann fremde Notizen in der Oberfläche nicht öffnen. Technisch könnte ein Admin Passwort und MFA eines Kontos zurücksetzen und sich damit anmelden. Das wird protokolliert, und der Betroffene merkt es, weil sein Passwort danach nicht mehr funktioniert. Für den **Tresor** gilt das nicht: Ohne Tresor-Passwort oder Wiederherstellungsschlüssel sieht auch dann niemand mehr als „Tresor – gesperrt“ (löschen ließe er sich, wie das ganze Konto).
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
| `EXTERNAL_IMAGES` | `true` | Bilder von fremden Servern in Notizen anzeigen; `false` blockiert sie (ein externes Bild verrät dem fremden Server beim Öffnen die IP-Adresse) |
| `SHARING` | `true` | Notizen per Link zum Lesen teilen (`/s/…`, ohne Anmeldung); `false` schaltet alle Freigaben ab |
| `MAX_UPLOAD_MB` | `25` | Maximale Größe hochgeladener Dateien |
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

Zum **Tresor**: Sicherungen enthalten Tresor-Notizen nur verschlüsselt – aber den alten Klartext von Notizen, die erst später in den Tresor verschoben wurden. Nach dem Zurückspielen einer Sicherung gilt das Tresor-Passwort von damals; auf Geräten, die nach einem Passwortwechsel offline waren, bis zur nächsten Verbindung noch das alte.

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

## Notizen mitnehmen

- **Einzelne Notiz**: **Kopieren** legt das Markdown in die Zwischenablage; im Menü daneben lässt sich die Notiz auch als Datei herunterladen. Der Titel der Notiz ist der Dateiname.
- **Alles auf einmal**: Lade unter **Einstellungen → Export & Import** das ZIP herunter. Es enthält alle Notizen als Dateien in ihrer Ordnerstruktur, die hochgeladenen Dateien im Ordner `Anhänge/` (mit den Anmerkungen zu PDFs), die Karteikarten als Markdown und als Stapel-Datei (`.noted-deck.zip`) und die Termine als `Kalender.ics`.
- **Bestehende Notizen übernehmen**: Packe einen Ordner mit Markdown-Dateien als ZIP und importiere ihn. Ordnerstruktur, Notizen und Dateien werden übernommen, versteckte Ordner (z. B. Einstellungen anderer Programme) ignoriert.
- **Teilen** (**⋮ → Teilen …** in der Notiz): erzeugt einen Link, mit dem Kommilitonen die Notiz ohne Konto lesen können – nicht bearbeiten. Gültig 7 Tage, 30 Tage oder unbegrenzt. Eingebettete Bilder und PDFs der Notiz sind dabei, Links auf andere Notizen erscheinen nur als Text, Canvas lässt sich nicht teilen. Den Link siehst du nur beim Erstellen (gespeichert wird nur ein Hash). Widerrufen kannst du ihn im Dialog oder unter **Einstellungen → Geteilte Links**; dort steht auch, wie oft er geöffnet wurde. Liegt die Notiz im Papierkorb, ist der Link so lange tot. Notizen im Tresor lassen sich nicht teilen; kommt eine geteilte Notiz in den Tresor, sind ihre Links tot. Mit `SHARING=false` ist Teilen für die ganze Instanz abgeschaltet.

Titel dürfen keine Zeichen enthalten, die in Dateinamen oder Wikilinks Probleme machen: `\ / : * ? " < > | # ^ [ ]`.

## Tastenkürzel

| Kürzel | Aktion |
| --- | --- |
| `Strg/⌘ + K` (oder `+ O`) | Schnellwechsler: Notiz suchen, öffnen oder anlegen |
| `Alt + N` | Neue Notiz |
| `Alt + J` | Schmierzettel öffnen bzw. den Cursor hineinsetzen (`Esc` springt zurück) |
| `Strg/⌘ + Shift + F` | Volltextsuche |
| `Strg/⌘ + S` | Sofort speichern (passiert sonst automatisch) |
| `Strg/⌘ + F` | Im Editor suchen und ersetzen – im PDF die Suche im PDF (ausgewählter Text wird übernommen) |
| `Strg/⌘ + B` / `I` | Fett / kursiv |
| `Strg/⌘ + Shift + H` | ==Markieren== – im PDF: ausgewählten Text markieren |
| `Strg/⌘ + P` | Drucken (Notiz, Glossar, Stapel) – sonst Schnellwechsler |
| `Strg + Umschalt + [` / `]` (Mac: `⌘ + ⌥ + [` / `]`) | Im Editor: Abschnitt am Cursor einklappen / aufklappen (auf Tastaturen, die `[` nur mit AltGr tippen, per Rechtsklick) |
| `Strg + Alt + [` / `]` | Im Editor: alle Abschnitte einklappen / aufklappen – nicht unter Windows, wo `Strg + Alt` für AltGr steht und damit Klammern getippt werden; dort per Rechtsklick |
| `Tab` / `Umschalt + Tab` in einer Tabelle | Im Editor: nächste / vorige Zelle, die Tabelle wird dabei ausgerichtet |
| `/` (am Zeilenanfang oder nach einem Leerzeichen) | Im Editor: Menü zum Einfügen von Überschriften, Listen, Tabellen, Formeln … |
| `Strg/⌘ + Klick` | Im Editor: Link, Tag oder Adresse öffnen · in Notizlisten: Notiz auswählen bzw. abwählen |
| `Umschalt + Klick` | In Notizlisten: Bereich bis hierher auswählen (mit `Strg/⌘` dazu) |
| `Strg/⌘ + A` | In Notizlisten: alle Notizen auswählen |
| `Esc` | In Notizlisten: Auswahl aufheben |
| Rechtsklick, `Umschalt + F10` oder Kontextmenütaste | Kontextmenü mit den Aktionen für das, was darunter liegt (Notiz, Ordner, Text im Editor, Link, Karte, Termin, Datei …) |
| `Umschalt` + Rechtsklick | Das Menü des Browsers statt des eigenen (in Eingabefeldern und Dialogen gibt es immer das des Browsers) |

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
- Frontend: Next.js 16 (App Router), React 19, Tailwind CSS 4, TanStack Query, CodeMirror 6, TipTap (formatierter Text), React Flow (Mindmap, Canvas und Graph), markdown-it, KaTeX, Mermaid, pdf.js
- Backend: SQLite (better-sqlite3, FTS5-Volltextsuche), pdf.js (Text aus PDFs für die Suche), @node-rs/argon2, otpauth

**Aufbau** – nach Features gegliedert (Regeln für Beiträge stehen in [`AGENTS.md`](AGENTS.md)):

```
app/                    Nur Routing: Seiten (Login, Setup, Notizen, Einstellungen, Admin, geteilte Notizen) und API-Routen (app/api)
features/               Ein Ordner je fachlichem Bereich, jeweils mit components/, client/, server/ und Tests
  workspace/            App-Rahmen: Startseite, Seitenleiste, Navigation, App-Kontext, Benutzermenü, Werkzeugleiste und Fenster
  notes/                Notizen in fünf Formaten, Ordner (mit Drag & Drop), Mehrfachauswahl, Tags, Suche, Papierkorb, Verlauf, Editoren, Vorschau, Gliederung, Sync, Vorlagen
  mindmap/              Mindmap: Markdown-Gliederung ↔ Baum, Anordnung, Editor
  canvas/               Canvas im Format JSON Canvas: Lesen/Schreiben, Pfade für Export, Editor mit Karten und Pfeilen
  attachments/          Dateien: Upload, Bereich „Dateien“ (Ordner der einbettenden Notizen), Auslieferung, Volltextsuche
  flashcards/           Karteikarten: Stapel, Karteneditor, Lernen/Üben, Wiederholungsplan (SM-2, FSRS samt Optimierung der Parameter), Klausurmodus, Karten ↔ Markdown, Stapel als Datei, Notiz abfragen
  glossary/             Glossar und Formelsammlung aus den Notizen
  graph/                Graph der Wikilinks: Daten, kräftebasierte Anordnung, Gesamtansicht und lokaler Graph
  sharing/              Notizen per Link teilen: Freigaben, öffentliche Leseansicht (/s/…), Verwaltung
  vault/                Tresor: Krypto (WebCrypto), Schlüssel im Tab, Sperren, Ver- und Entschlüsseln der Notizen, Verschieben über die Grenze, Einrichten und Einstellungen
  focus/                Fokus-Timer: Pomodoro und Countdown, Ton und Benachrichtigung, gezählte Runden (Lernzeit pro Fach)
  scratchpad/           Schmierzettel: ein Text je Konto, lokal zuerst gespeichert, Zusammenführen zwischen Geräten, Übernehmen in Notizen
  calendar/             Kalender: Termine und wöchentliche Serien, Woche/Monat, Terminliste, .ics lesen und schreiben
  pdf/                  PDF-Viewer (pdf.js), geteilte Ansicht und Anmerkungen (Markierungen mit Kommentar)
  transfer/             Export und Import (ZIP mit Ordnerstruktur, Dateien, Karteikarten und Kalender)
  auth/                 Anmeldung, MFA, Passwörter, Sitzungen, Konten, Absicherung der API-Routen
  admin/                Benutzerverwaltung (Administration)
  settings/             Einstellungsseite
  updates/              Version, Update-Erkennung im Browser, Status der automatischen Updates
shared/                 Feature-unabhängiger Code (importiert nie aus features/)
  ui/                   Bausteine: Button, Eingabefelder, Menü, Dialog, Meldungen, Seitengerüst, Kasten, Platz für feste Leisten, Druckansicht
  client/               API-Client, Zwischenablage, lokale Einstellungen, Media-Queries, laufende Uhrzeit
  server/               Datenbank und Migrationen, Konfiguration, HTTP-Hilfen, Verschlüsselung, Rate-Limits, Protokoll, ZIP, Volltextsuche
  markdown/             Markdown: Frontmatter, Tags, Wikilinks, Rendering, Bereinigung
  lib/                  Namensregeln, Formatierung, HTML-Hilfen
sw/service-worker.js    Service Worker (Offline, Update-Erkennung) – public/sw.js wird beim Build daraus erzeugt
instrumentation.ts      Serverstart: Datenbank öffnen und migrieren, ersten Admin anlegen, regelmäßig aufräumen
proxy.ts                Content-Security-Policy und Login-Umleitung (außer /login und geteilten Notizen unter /s)
scripts/install.sh      Installer für Ubuntu/Debian
scripts/auto-update.sh  Automatische Updates auf dem Server (Status in .update/)
scripts/domain.sh       Domain anzeigen/ändern (sudo noted-domain)
scripts/build-info.mjs  Versionsinfos für den Build (läuft vor `npm run build`)
scripts/vendor-pdfjs.mjs  Kopiert Worker, Schriften und Decoder von pdf.js nach public/pdfjs (vor `build` und `dev`)
scripts/admin-cli.mjs   Notfall-Werkzeug für Admins (inkl. Sicherung/Wiederherstellung)
tests/                  Testhelfer und Tests für die Skripte in scripts/
e2e/                    Browser-Tests (Playwright)
```
