import 'server-only'

/**
 * Datenbank-Migrationen. Jede Migration wird genau einmal ausgeführt
 * (gesteuert über PRAGMA user_version). Niemals bestehende Einträge ändern –
 * nur neue anhängen.
 */
export const migrations: string[] = [
  /* 1: Grundschema */ `
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

  CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX folders_user ON folders(user_id);
  CREATE INDEX folders_parent ON folders(parent_id);

  CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE note_links (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    target TEXT NOT NULL,
    PRIMARY KEY (note_id, target)
  );
  CREATE INDEX note_links_target ON note_links(target);

  CREATE VIRTUAL TABLE notes_fts USING fts5(
    note_id UNINDEXED,
    user_id UNINDEXED,
    title,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX attachments_name ON attachments(user_id, filename COLLATE NOCASE);
  `,

  /* 2: Zuordnung Notiz → Zeile im Suchindex (Löschen per rowid statt Tabellenscan) */ `
  CREATE TABLE notes_fts_map (
    note_id TEXT PRIMARY KEY,
    fts_rowid INTEGER NOT NULL UNIQUE
  );
  INSERT OR REPLACE INTO notes_fts_map (note_id, fts_rowid) SELECT note_id, rowid FROM notes_fts;
  `,

  /* 3: Karteikarten – Stapel, Karten und Lernstand (Wiederholungsplan je Kartenseite) */ `
  CREATE TABLE decks (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    new_per_day INTEGER NOT NULL DEFAULT 20,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX decks_user ON decks(user_id);

  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    note_id TEXT,
    type TEXT NOT NULL CHECK (type IN ('basic', 'reversed', 'mc')),
    front TEXT NOT NULL,
    back TEXT NOT NULL DEFAULT '',
    options TEXT NOT NULL DEFAULT '[]',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX cards_deck ON cards(deck_id, position);
  CREATE INDEX cards_user ON cards(user_id);
  CREATE INDEX cards_note ON cards(note_id);

  CREATE TABLE card_reviews (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    side INTEGER NOT NULL CHECK (side IN (0, 1)),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phase TEXT NOT NULL CHECK (phase IN ('learning', 'review', 'relearning')),
    step INTEGER NOT NULL DEFAULT 0,
    interval REAL NOT NULL DEFAULT 0,
    ease REAL NOT NULL,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    due INTEGER NOT NULL,
    reviewed_at INTEGER NOT NULL,
    introduced_at INTEGER NOT NULL,
    PRIMARY KEY (card_id, side)
  );
  CREATE INDEX card_reviews_user ON card_reviews(user_id);
  `,

  /* 4: Format einer Notiz – markdown, richtext (HTML aus dem Editor), text (ohne Formatierung) */ `
  ALTER TABLE notes ADD COLUMN format TEXT NOT NULL DEFAULT 'markdown' CHECK (format IN ('markdown', 'richtext', 'text'));
  `,

  /* 5: Formate Mindmap und Canvas. SQLite kann eine CHECK-Bedingung nicht ändern – daher die Spalte über eine
     neue ersetzen (DROP COLUMN statt Tabelle neu anlegen: so greifen die Fremdschlüssel von Tags und Links nicht) */ `
  ALTER TABLE notes ADD COLUMN format_new TEXT NOT NULL DEFAULT 'markdown'
    CHECK (format_new IN ('markdown', 'richtext', 'text', 'mindmap', 'canvas'));
  UPDATE notes SET format_new = format;
  ALTER TABLE notes DROP COLUMN format;
  ALTER TABLE notes RENAME COLUMN format_new TO format;
  `,

  /* 6: Verbundener Kalender (Microsoft) je Benutzer – Tokens verschlüsselt (encrypt), calendars = gewählte
     Kalender als JSON (NULL = Standardkalender), error = Hinweis, wenn die Verbindung erneuert werden muss */ `
  CREATE TABLE calendar_accounts (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('microsoft')),
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    refresh_token TEXT NOT NULL,
    access_token TEXT,
    access_expires_at INTEGER,
    calendars TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,

  /* 7: Eigener Kalender statt Microsoft-Anbindung. Zeiten als Ortszeit ohne Zone (YYYY-MM-DDTHH:mm, ganztägig
     YYYY-MM-DD, Ende exklusiv); repeat_weeks/repeat_until = wöchentliche Serie, exdates = ausfallende Tage (JSON),
     uid = Kennung aus einer importierten .ics-Datei, damit ein zweiter Import nichts doppelt anlegt */ `
  DROP TABLE IF EXISTS calendar_accounts;
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
    uid TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX events_user ON events(user_id, start_at);
  CREATE UNIQUE INDEX events_uid ON events(user_id, uid) WHERE uid IS NOT NULL;
  `,

  /* 8: Stapel mit „Antwort eintippen“ – bei Grund- und beidseitigen Karten erscheint beim Lernen ein Eingabefeld */ `
  ALTER TABLE decks ADD COLUMN type_answer INTEGER NOT NULL DEFAULT 0 CHECK (type_answer IN (0, 1));
  `,

  /* 9: Ausgesetzte Karten (z. B. Problemkarten bis zur Überarbeitung) – kommen beim Lernen und Üben nicht dran */ `
  ALTER TABLE cards ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0, 1));
  `,

  /* 10: Bewertungsprotokoll – jede Bewertung im Lernmodus (für Statistik, später Klausurmodus und FSRS). Bleibt beim
     Löschen von Karten und beim Zurücksetzen des Lernstands erhalten; deck_id ist der Stapel zum Zeitpunkt der
     Bewertung. phase = Phase vor der Bewertung ('new' bei der ersten Abfrage), Abstände in Tagen. Der eindeutige
     Index verhindert doppelte Einträge, wenn ein Gerät dieselben Bewertungen erneut sendet. */ `
  CREATE TABLE review_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    deck_id TEXT,
    side INTEGER NOT NULL CHECK (side IN (0, 1)),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
    phase TEXT NOT NULL CHECK (phase IN ('new', 'learning', 'review', 'relearning')),
    interval_before REAL NOT NULL,
    interval_after REAL NOT NULL,
    duration_ms INTEGER NOT NULL,
    reviewed_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX review_log_once ON review_log(user_id, card_id, side, reviewed_at);
  CREATE INDEX review_log_user ON review_log(user_id, reviewed_at);
  `,

  /* 11: Gezählte Runden des Fokus-Timers (Lernzeit pro Fach). Die ID vergibt das Gerät – so kommt eine offline
     gesammelte Runde auch beim erneuten Senden nur einmal an. subject = Fach (freier Text), goal = Ziel der Runde */ `
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

  /* 12: Lückentext-Karten. Neue Kartenart 'cloze' (CHECK erweitern wie in Migration 5); jede Lücke hat einen eigenen
     Lernstand – side ist bei Lückentexten die Nummer der Lücke (0 … 49). side gehört zum Primärschlüssel bzw. zu einem
     Index und lässt sich nicht per DROP COLUMN ersetzen: Lernstand und Protokoll werden daher neu angelegt und
     umkopiert (beide werden von keiner anderen Tabelle referenziert). */ `
  ALTER TABLE cards ADD COLUMN type_new TEXT NOT NULL DEFAULT 'basic' CHECK (type_new IN ('basic', 'reversed', 'mc', 'cloze'));
  UPDATE cards SET type_new = type;
  ALTER TABLE cards DROP COLUMN type;
  ALTER TABLE cards RENAME COLUMN type_new TO type;

  CREATE TABLE card_reviews_new (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    side INTEGER NOT NULL CHECK (side BETWEEN 0 AND 49),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phase TEXT NOT NULL CHECK (phase IN ('learning', 'review', 'relearning')),
    step INTEGER NOT NULL DEFAULT 0,
    interval REAL NOT NULL DEFAULT 0,
    ease REAL NOT NULL,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    due INTEGER NOT NULL,
    reviewed_at INTEGER NOT NULL,
    introduced_at INTEGER NOT NULL,
    PRIMARY KEY (card_id, side)
  );
  INSERT INTO card_reviews_new (card_id, side, user_id, phase, step, interval, ease, reps, lapses, due, reviewed_at, introduced_at)
    SELECT card_id, side, user_id, phase, step, interval, ease, reps, lapses, due, reviewed_at, introduced_at FROM card_reviews;
  DROP TABLE card_reviews;
  ALTER TABLE card_reviews_new RENAME TO card_reviews;
  CREATE INDEX card_reviews_user ON card_reviews(user_id);

  CREATE TABLE review_log_new (
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
  INSERT INTO review_log_new SELECT * FROM review_log;
  DROP TABLE review_log;
  ALTER TABLE review_log_new RENAME TO review_log;
  CREATE UNIQUE INDEX review_log_once ON review_log(user_id, card_id, side, reviewed_at);
  CREATE INDEX review_log_user ON review_log(user_id, reviewed_at);
  `,

  /* 13: Wiederholungsplan mit FSRS, wählbar je Stapel (scheduler, retention = gewünschte Behaltensrate). Mit FSRS
     geplante Kartenseiten haben zusätzlich Stabilität und Schwierigkeit; bei SM-2 bleiben beide leer. */ `
  ALTER TABLE decks ADD COLUMN scheduler TEXT NOT NULL DEFAULT 'sm2' CHECK (scheduler IN ('sm2', 'fsrs'));
  ALTER TABLE decks ADD COLUMN retention REAL NOT NULL DEFAULT 0.9 CHECK (retention BETWEEN 0.7 AND 0.99);
  ALTER TABLE card_reviews ADD COLUMN stability REAL;
  ALTER TABLE card_reviews ADD COLUMN difficulty REAL;
  `,

  /* 14: Klausurmodus. Ein einzelner Termin kann eine Klausur sein (exam) und mit Karteikarten-Stapeln verknüpft
     werden, die bis dahin wiederholt werden. Termin und Stapel gehören immer demselben Nutzer (prüft der Server). */ `
  ALTER TABLE events ADD COLUMN exam INTEGER NOT NULL DEFAULT 0 CHECK (exam IN (0, 1));
  CREATE TABLE exam_decks (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, deck_id)
  );
  CREATE INDEX exam_decks_deck ON exam_decks(deck_id);
  `,

  /* 15: Klausurzulassung. Fächer mit nötiger Quote (required_percent) und geplanter Zahl an Übungsblättern;
     Blätter mit erreichbaren und erreichten Punkten (points NULL = noch nicht korrigiert). Die Abgabe ist ein Termin
     im Kalender (event_id) – wird er dort gelöscht, hat das Blatt keine Abgabe mehr. */ `
  CREATE TABLE courses (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    required_percent REAL NOT NULL DEFAULT 50 CHECK (required_percent BETWEEN 0 AND 100),
    planned_sheets INTEGER CHECK (planned_sheets BETWEEN 1 AND 100),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX courses_user ON courses(user_id);
  CREATE TABLE exercise_sheets (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    max_points REAL NOT NULL CHECK (max_points > 0),
    points REAL CHECK (points >= 0),
    event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX exercise_sheets_user ON exercise_sheets(user_id, course_id);
  CREATE INDEX exercise_sheets_event ON exercise_sheets(event_id);
  `,

  /* 16: Aufgaben zum Wiederholen (Altklausuren, Übungsaufgaben) je Fach. result = Ergebnis der letzten Bearbeitung
     (NULL = noch nicht bearbeitet), due = Tag der nächsten Wiederholung (YYYY-MM-DD, nur bei unsicher und falsch). */ `
  CREATE TABLE course_tasks (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    solution TEXT NOT NULL DEFAULT '',
    result TEXT CHECK (result IN ('solved', 'unsure', 'wrong')),
    attempts INTEGER NOT NULL DEFAULT 0,
    due TEXT,
    attempted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX course_tasks_user ON course_tasks(user_id, course_id);
  `,

  /* 17: Bildverdeckung (Image Occlusion). Neue Kartenart 'occlusion' (CHECK erweitern wie in Migration 12); die
     Flächen stehen als JSON in occlusion ({ masks: [{ x, y, w, h, label }], hideAll }, Werte relativ zur Bildgröße).
     Jede Fläche hat einen eigenen Lernstand – side ist die Nummer der Fläche. */ `
  ALTER TABLE cards ADD COLUMN type_new TEXT NOT NULL DEFAULT 'basic'
    CHECK (type_new IN ('basic', 'reversed', 'mc', 'cloze', 'occlusion'));
  UPDATE cards SET type_new = type;
  ALTER TABLE cards DROP COLUMN type;
  ALTER TABLE cards RENAME COLUMN type_new TO type;
  ALTER TABLE cards ADD COLUMN occlusion TEXT;
  `,

  /* 18: Übungen (Migrationen 15 und 16) entfernt – samt den Abgabe-Terminen der Übungsblätter im Kalender. */ `
  DELETE FROM events WHERE id IN (SELECT event_id FROM exercise_sheets WHERE event_id IS NOT NULL);
  DROP TABLE course_tasks;
  DROP TABLE exercise_sheets;
  DROP TABLE courses;
  `,

  /* 19: Versionsverlauf. Gesichert wird jeweils der bisherige Stand einer Notiz, bevor er überschrieben wird
     (reason: Bearbeiten nach einer Pause, Konflikt, Wiederherstellen, Formatwechsel). */ `
  CREATE TABLE note_versions (
    id INTEGER PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    format TEXT NOT NULL,
    content TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('edit', 'conflict', 'restore', 'format')),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX note_versions_note ON note_versions(note_id, created_at);
  `,

  /* 20: Volltextsuche in Anhängen (PDF und Textdateien). Eine Zeile je Seite, damit Treffer eine Seitenzahl haben
     (Textdateien: Seite 1). attachments_index merkt sich je Datei, ob sie durchsuchbar ist (done), übersprungen
     wurde (skipped, Grund in reason – z. B. kein Text oder zu groß) oder beim Lesen ein Fehler auftrat (failed). */ `
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
  `,

  /* 21: Notizen per Link teilen (nur lesen). id ist der SHA-256 des Tokens aus dem Link – das Token selbst wird nicht
     gespeichert. expires_at NULL = unbegrenzt; opens und last_opened_at zählen Aufrufe der geteilten Seite. */ `
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
  `,
]
