import 'server-only'

/**
 * Datenbank-Migrationen. Jede Migration wird genau einmal ausgeführt
 * (gesteuert über PRAGMA user_version). Niemals bestehende Einträge ändern –
 * nur neue anhängen.
 */
export const migrations: string[] = [
  /* 1: Grundschema */ `
  -- Konten und Anmeldung ---------------------------------------------------------------------------------------------

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    is_active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    mfa_secret TEXT,
    mfa_pending_secret TEXT,
    mfa_pending_created_at INTEGER,
    mfa_last_step INTEGER NOT NULL DEFAULT 0,
    mfa_required INTEGER NOT NULL DEFAULT 0,
    failed_logins INTEGER NOT NULL DEFAULT 0,
    mfa_failed INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    last_login_at INTEGER,
    password_changed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('mfa', 'full')),
    mfa_attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX sessions_expires ON sessions(expires_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    created_at INTEGER NOT NULL,
    event TEXT NOT NULL,
    user_id INTEGER,
    username TEXT,
    actor_id INTEGER,
    actor_username TEXT,
    ip TEXT,
    details TEXT
  );
  CREATE INDEX audit_created ON audit_log(created_at);

  -- Ordner und Notizen -----------------------------------------------------------------------------------------------
  -- vault/name_enc bzw. vault/title_enc: Ordner und Notizen im Tresor (siehe vaults). Sie haben ihre ID als
  -- Platzhalter-Name bzw. -Titel, der echte steht verschlüsselt in name_enc bzw. title_enc. notes.vault zusätzlich zur
  -- Ordnerzugehörigkeit, weil folder_id im Papierkorb NULL werden kann.

  CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    vault INTEGER NOT NULL DEFAULT 0 CHECK (vault IN (0, 1)),
    name_enc TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX folders_user ON folders(user_id);
  CREATE INDEX folders_parent ON folders(parent_id);

  -- format: markdown, richtext (HTML aus dem Editor), text (ohne Formatierung), mindmap, canvas
  CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'markdown' CHECK (format IN ('markdown', 'richtext', 'text', 'mindmap', 'canvas')),
    content TEXT NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
    vault INTEGER NOT NULL DEFAULT 0 CHECK (vault IN (0, 1)),
    title_enc TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX notes_user ON notes(user_id, deleted_at);
  CREATE INDEX notes_folder ON notes(folder_id);

  CREATE TABLE note_tags (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (note_id, tag)
  );
  CREATE INDEX note_tags_tag ON note_tags(tag);

  -- Wikilinks: target = Titel-Schlüssel, path = Ordnerteil des Links, klein geschrieben ('' ohne Ordner) –
  -- [[Analysis/Übung 1]] meint die „Übung 1“ im Ordner Analysis.
  CREATE TABLE note_links (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    target TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (note_id, target, path)
  );
  CREATE INDEX note_links_target ON note_links(target);

  -- Volltextsuche. secure-delete: Gelöschtes verschwindet wirklich aus dem Index (wichtig für Notizen, die in den
  -- Tresor wandern). notes_fts_map ordnet jeder Notiz ihre Zeile im Index zu – Löschen per rowid statt Tabellenscan.
  CREATE VIRTUAL TABLE notes_fts USING fts5(
    note_id UNINDEXED,
    user_id UNINDEXED,
    title,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  INSERT INTO notes_fts(notes_fts, rank) VALUES ('secure-delete', 1);

  CREATE TABLE notes_fts_map (
    note_id TEXT PRIMARY KEY,
    fts_rowid INTEGER NOT NULL UNIQUE
  );

  -- Versionsverlauf: jeweils der bisherige Stand einer Notiz, bevor er überschrieben wird (reason: Bearbeiten nach
  -- einer Pause, Konflikt, Wiederherstellen, Formatwechsel)
  CREATE TABLE note_versions (
    id INTEGER PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    title_enc TEXT,
    format TEXT NOT NULL,
    content TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('edit', 'conflict', 'restore', 'format')),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX note_versions_note ON note_versions(note_id, created_at);

  -- Notizen per Link teilen (nur lesen). id ist der SHA-256 des Tokens aus dem Link – das Token selbst wird nicht
  -- gespeichert. expires_at NULL = unbegrenzt; opens und last_opened_at zählen Aufrufe der geteilten Seite.
  CREATE TABLE shares (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    last_opened_at INTEGER,
    opens INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX shares_note ON shares(note_id);

  -- Tresor: Ende-zu-Ende verschlüsselte Notizen. Gespeichert werden nur Umschläge („nv1.…“,
  -- features/vault/format.ts) und verpackte Schlüssel; der Tresor-Schlüssel verlässt nie den Browser. kdf = JSON
  -- {"name":"PBKDF2-SHA-256","iterations":600000,"salt":"…"}
  CREATE TABLE vaults (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    folder_id TEXT NOT NULL UNIQUE REFERENCES folders(id) ON DELETE CASCADE,
    kdf TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    recovery_salt TEXT NOT NULL,
    recovery_wrapped_key TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Schmierzettel – ein Text je Konto, keine Notiz (nicht in Suche, Tags, Graph oder Export). version zählt jede
  -- Änderung hoch; der Browser schickt die Version mit, auf der sein Text beruht (Konflikt zwischen Geräten).
  CREATE TABLE scratchpads (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  -- Anhänge ----------------------------------------------------------------------------------------------------------

  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX attachments_name ON attachments(user_id, filename COLLATE NOCASE);

  -- Volltextsuche in Anhängen (PDF und Textdateien). Eine Zeile je Seite, damit Treffer eine Seitenzahl haben
  -- (Textdateien: Seite 1). attachments_index merkt sich je Datei, ob sie durchsuchbar ist (done), übersprungen wurde
  -- (skipped, Grund in reason – z. B. kein Text oder zu groß) oder beim Lesen ein Fehler auftrat (failed).
  CREATE VIRTUAL TABLE attachments_fts USING fts5(
    attachment_id UNINDEXED,
    user_id UNINDEXED,
    page UNINDEXED,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TABLE attachments_index (
    attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('done', 'skipped', 'failed')),
    pages INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    indexed_at INTEGER NOT NULL
  );

  -- Anmerkungen in PDFs. kind: 'text' markiert ausgewählten Text (ein Rechteck je Zeile), 'area' einen aufgezogenen
  -- Bereich (genau ein Rechteck – für Scans, Formeln und Abbildungen). rects ist eine JSON-Liste von Rechtecken
  -- [x1, y1, x2, y2] in PDF-Koordinaten der Seite (unabhängig von Zoom und Gerät), quote der markierte Text. Die ID
  -- vergibt der Browser, damit Markierungen auch offline entstehen und später gesendet werden können.
  CREATE TABLE pdf_annotations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'area')),
    page INTEGER NOT NULL,
    rects TEXT NOT NULL,
    quote TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    color INTEGER NOT NULL DEFAULT 1 CHECK (color BETWEEN 1 AND 6),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX pdf_annotations_attachment ON pdf_annotations(user_id, attachment_id, page);

  -- Karteikarten -----------------------------------------------------------------------------------------------------
  -- type_answer: bei Grund- und beidseitigen Karten erscheint beim Lernen ein Eingabefeld. scheduler: Wiederholungsplan
  -- des Stapels, retention = gewünschte Behaltensrate bei FSRS. learning_steps/relearning_steps: Lernschritte in
  -- Minuten, durch Leerzeichen getrennt (neu bzw. nach dem Vergessen); review_per_day: höchstens so viele
  -- Wiederholungen pro Tag (9999: ohne Grenze); leech_*: Problemkarten ab so vielen Malen vergessen – nur markiert oder
  -- gleich ausgesetzt.

  CREATE TABLE decks (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    new_per_day INTEGER NOT NULL DEFAULT 20,
    review_per_day INTEGER NOT NULL DEFAULT 9999 CHECK (review_per_day BETWEEN 0 AND 9999),
    learning_steps TEXT NOT NULL DEFAULT '1 10',
    relearning_steps TEXT NOT NULL DEFAULT '10',
    leech_lapses INTEGER NOT NULL DEFAULT 6 CHECK (leech_lapses BETWEEN 1 AND 99),
    leech_action TEXT NOT NULL DEFAULT 'mark' CHECK (leech_action IN ('mark', 'suspend')),
    type_answer INTEGER NOT NULL DEFAULT 0 CHECK (type_answer IN (0, 1)),
    scheduler TEXT NOT NULL DEFAULT 'sm2' CHECK (scheduler IN ('sm2', 'fsrs')),
    retention REAL NOT NULL DEFAULT 0.9 CHECK (retention BETWEEN 0.7 AND 0.99),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX decks_user ON decks(user_id);

  -- Einstellungen der Karteikarten je Konto: Stunde, zu der ein neuer Lerntag beginnt (0 = Mitternacht). Gilt für alle
  -- Stapel, die Statistik und die Serie.
  CREATE TABLE flashcard_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    day_start_hour INTEGER NOT NULL DEFAULT 0 CHECK (day_start_hour BETWEEN 0 AND 23)
  );

  -- occlusion: Flächen einer Bildverdeckung als JSON ({ masks: [{ x, y, w, h, label }], hideAll }, Werte relativ zur
  -- Bildgröße). suspended: ausgesetzte Karten (z. B. Problemkarten bis zur Überarbeitung) kommen beim Lernen und Üben
  -- nicht dran.
  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    note_id TEXT,
    type TEXT NOT NULL DEFAULT 'basic' CHECK (type IN ('basic', 'reversed', 'mc', 'cloze', 'occlusion')),
    front TEXT NOT NULL,
    back TEXT NOT NULL DEFAULT '',
    options TEXT NOT NULL DEFAULT '[]',
    occlusion TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX cards_deck ON cards(deck_id, position);
  CREATE INDEX cards_user ON cards(user_id);
  CREATE INDEX cards_note ON cards(note_id);

  -- Lernstand je Kartenseite. side: 0/1 bei Grund- und beidseitigen Karten, bei Lückentexten die Nummer der Lücke, bei
  -- Bildverdeckung die Nummer der Fläche. stability/difficulty nur bei Stapeln mit FSRS, bei SM-2 leer.
  CREATE TABLE card_reviews (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    side INTEGER NOT NULL CHECK (side BETWEEN 0 AND 49),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phase TEXT NOT NULL CHECK (phase IN ('learning', 'review', 'relearning')),
    step INTEGER NOT NULL DEFAULT 0,
    interval REAL NOT NULL DEFAULT 0,
    ease REAL NOT NULL,
    stability REAL,
    difficulty REAL,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    due INTEGER NOT NULL,
    reviewed_at INTEGER NOT NULL,
    introduced_at INTEGER NOT NULL,
    PRIMARY KEY (card_id, side)
  );
  CREATE INDEX card_reviews_user ON card_reviews(user_id);

  -- Bewertungsprotokoll – jede Bewertung im Lernmodus (für Statistik und das Optimieren der FSRS-Parameter). Bleibt
  -- beim Löschen von Karten und beim Zurücksetzen des Lernstands erhalten; deck_id ist der Stapel zum Zeitpunkt der
  -- Bewertung. phase = Phase vor der Bewertung ('new' bei der ersten Abfrage), Abstände in Tagen. Der eindeutige Index
  -- verhindert doppelte Einträge, wenn ein Gerät dieselben Bewertungen erneut sendet.
  CREATE TABLE review_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    deck_id TEXT,
    side INTEGER NOT NULL CHECK (side BETWEEN 0 AND 49),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
    phase TEXT NOT NULL CHECK (phase IN ('new', 'learning', 'review', 'relearning')),
    interval_before REAL NOT NULL,
    interval_after REAL NOT NULL,
    duration_ms INTEGER NOT NULL,
    reviewed_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX review_log_once ON review_log(user_id, card_id, side, reviewed_at);
  CREATE INDEX review_log_user ON review_log(user_id, reviewed_at);

  -- Eigene FSRS-Parameter je Konto, aus dem Bewertungsprotokoll geschätzt („Parameter optimieren“). weights = JSON mit
  -- den 19 Gewichten von FSRS-5; reviews = ausgewertete Wiederholungen; log_loss/rmse = Vorhersagefehler mit diesen
  -- Gewichten, default_* mit den Standardwerten auf denselben Daten. Keine Zeile = Standardwerte.
  CREATE TABLE fsrs_params (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    weights TEXT NOT NULL,
    reviews INTEGER NOT NULL,
    log_loss REAL NOT NULL,
    rmse REAL NOT NULL,
    default_log_loss REAL NOT NULL,
    default_rmse REAL NOT NULL,
    optimized_at INTEGER NOT NULL
  );

  -- Kalender ---------------------------------------------------------------------------------------------------------
  -- Zeiten als Ortszeit ohne Zone (YYYY-MM-DDTHH:mm, ganztägig YYYY-MM-DD, Ende exklusiv); repeat_weeks/repeat_until =
  -- wöchentliche Serie, exdates = ausfallende Tage (JSON), uid = Kennung aus einer importierten .ics-Datei, damit ein
  -- zweiter Import nichts doppelt anlegt. exam: ein einzelner Termin kann eine Klausur sein und mit Stapeln verknüpft
  -- werden, die bis dahin wiederholt werden (exam_decks – Termin und Stapel gehören immer demselben Nutzer, prüft der
  -- Server).

  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    color INTEGER CHECK (color BETWEEN 1 AND 6),
    all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    repeat_weeks INTEGER,
    repeat_until TEXT,
    exdates TEXT NOT NULL DEFAULT '[]',
    exam INTEGER NOT NULL DEFAULT 0 CHECK (exam IN (0, 1)),
    uid TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX events_user ON events(user_id, start_at);
  CREATE UNIQUE INDEX events_uid ON events(user_id, uid) WHERE uid IS NOT NULL;

  CREATE TABLE exam_decks (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, deck_id)
  );
  CREATE INDEX exam_decks_deck ON exam_decks(deck_id);

  -- Fokus-Timer ------------------------------------------------------------------------------------------------------
  -- Gezählte Runden (Lernzeit pro Fach). Die ID vergibt das Gerät – so kommt eine offline gesammelte Runde auch beim
  -- erneuten Senden nur einmal an. subject = Fach (freier Text), goal = Ziel der Runde

  CREATE TABLE focus_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL DEFAULT '',
    goal TEXT NOT NULL DEFAULT '',
    started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX focus_sessions_user ON focus_sessions(user_id, started_at);
  `,

  /* 2: KI (Claude) */ `
  -- Eigener Anthropic-API-Schlüssel je Konto, mit encrypt() verschlüsselt wie die MFA-Geheimnisse. key_hint = die
  -- letzten Zeichen zum Wiedererkennen (der Schlüssel selbst geht nie zurück an den Browser), model = gewähltes
  -- Claude-Modell. Keine Zeile = KI aus.
  CREATE TABLE ai_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    api_key TEXT NOT NULL,
    key_hint TEXT NOT NULL,
    model TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
]
