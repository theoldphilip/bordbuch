import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

const migrations: string[] = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE tokens (
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name  TEXT,
    created_at   TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );

  CREATE TABLE trips (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    start_date TEXT,
    end_date   TEXT,
    notes      TEXT,
    color      TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE trip_members (
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role    TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
    PRIMARY KEY (trip_id, user_id)
  );

  CREATE TABLE cruises (
    id          TEXT PRIMARY KEY,
    trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    ship_name   TEXT NOT NULL,
    cruise_line TEXT,
    cabin       TEXT,
    booking_ref TEXT,
    notes       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE cruise_days (
    id         TEXT PRIMARY KEY,
    cruise_id  TEXT NOT NULL REFERENCES cruises(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('embarkation','port','sea','disembarkation')),
    port_name  TEXT,
    country    TEXT,
    timezone   TEXT,
    arrival    TEXT,
    departure  TEXT,
    all_aboard TEXT,
    tender     INTEGER NOT NULL DEFAULT 0,
    notes      TEXT
  );
  CREATE INDEX cruise_days_cruise ON cruise_days(cruise_id, date);

  CREATE TABLE items (
    id            TEXT PRIMARY KEY,
    trip_id       TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    type          TEXT NOT NULL,
    title         TEXT NOT NULL,
    start_local   TEXT NOT NULL,
    start_tz      TEXT,
    end_local     TEXT,
    end_tz        TEXT,
    location      TEXT,
    confirmation  TEXT,
    provider      TEXT,
    cost          REAL,
    currency      TEXT,
    notes         TEXT,
    details       TEXT NOT NULL DEFAULT '{}',
    cruise_day_id TEXT REFERENCES cruise_days(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX items_trip ON items(trip_id, start_local);

  CREATE TABLE attachments (
    id          TEXT PRIMARY KEY,
    trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    item_id     TEXT REFERENCES items(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    stored_name TEXT NOT NULL,
    uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX attachments_trip ON attachments(trip_id);
  `,
  `
  ALTER TABLE attachments ADD COLUMN analysis TEXT;
  ALTER TABLE attachments ADD COLUMN analysis_status TEXT;
  ALTER TABLE attachments ADD COLUMN analysis_error TEXT;
  `,
  `
  ALTER TABLE items ADD COLUMN infos TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE cruise_days ADD COLUMN infos TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE cruises ADD COLUMN infos TEXT NOT NULL DEFAULT '[]';
  `,
  `
  ALTER TABLE users ADD COLUMN settings TEXT NOT NULL DEFAULT '{}';
  `,
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE push_subscriptions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint     TEXT NOT NULL UNIQUE,
    p256dh       TEXT NOT NULL,
    auth         TEXT NOT NULL,
    device_name  TEXT,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);

  -- Which reminder was already sent to whom, so a reminder never fires twice.
  CREATE TABLE push_log (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
  `,
];

export function openDb(file: string): DB {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = user_version; v < migrations.length; v++) {
    tx(db, () => {
      db.exec(migrations[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
