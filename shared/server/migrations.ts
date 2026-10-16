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
]
