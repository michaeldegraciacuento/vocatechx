use std::path::Path;

use rusqlite::Connection;

use crate::auth;
use crate::error::AppResult;

pub const DATABASE_FILE: &str = "vocatechx.db";

/// Each entry upgrades the schema by one version. Never edit a released
/// migration; append a new one instead.
const MIGRATIONS: &[&str] = &[
  // v1: initial schema
  r#"
  CREATE TABLE users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT    NOT NULL UNIQUE COLLATE NOCASE
                                 CHECK (length(username) BETWEEN 3 AND 64),
    password_hash        TEXT    NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
    role                 TEXT    NOT NULL DEFAULT 'technician'
                                 CHECK (role IN ('admin', 'technician')),
    must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
    created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Keyed by attempted username (existing or not) so unknown usernames are
  -- throttled the same way and lockouts survive an app restart.
  CREATE TABLE login_throttle (
    username        TEXT    PRIMARY KEY COLLATE NOCASE,
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    last_failed_at  INTEGER NOT NULL,
    locked_until    INTEGER
  );

  CREATE TABLE app_settings (
    key        TEXT    PRIMARY KEY CHECK (length(key) > 0),
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE operation_runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_type TEXT    NOT NULL CHECK (length(operation_type) > 0),
    title          TEXT    NOT NULL CHECK (length(title) > 0),
    status         TEXT    NOT NULL DEFAULT 'running'
                           CHECK (status IN ('running', 'success', 'failed', 'cancelled')),
    summary        TEXT,
    started_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    finished_at    INTEGER CHECK (finished_at IS NULL OR finished_at >= started_at),
    user_id        INTEGER REFERENCES users (id) ON DELETE SET NULL
  );
  CREATE INDEX idx_operation_runs_started_at ON operation_runs (started_at DESC);

  CREATE TABLE operation_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id     INTEGER NOT NULL REFERENCES operation_runs (id) ON DELETE CASCADE,
    level      TEXT    NOT NULL CHECK (level IN ('info', 'warning', 'error')),
    message    TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX idx_operation_logs_run_id ON operation_logs (run_id);
  "#,
  // v2: Ralp (AI Troubleshooter) conversations
  r#"
  CREATE TABLE ai_conversations (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title            TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    operation_run_id INTEGER REFERENCES operation_runs (id) ON DELETE SET NULL,
    created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX idx_ai_conversations_user ON ai_conversations (user_id, updated_at DESC);

  CREATE TABLE ai_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES ai_conversations (id) ON DELETE CASCADE,
    role            TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT    NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX idx_ai_messages_conversation ON ai_messages (conversation_id, id);
  "#,
  // v3: CSS Learning Library progress, per account
  r#"
  CREATE TABLE learning_progress (
    user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    lesson_id      TEXT    NOT NULL CHECK (length(lesson_id) BETWEEN 1 AND 64),
    lesson_version INTEGER NOT NULL CHECK (lesson_version >= 1),
    last_step      INTEGER NOT NULL DEFAULT 0 CHECK (last_step >= 0),
    started_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    completed_at   INTEGER CHECK (completed_at IS NULL OR completed_at >= started_at),
    PRIMARY KEY (user_id, lesson_id)
  );

  CREATE TABLE learning_bookmarks (
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    lesson_id  TEXT    NOT NULL CHECK (length(lesson_id) BETWEEN 1 AND 64),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, lesson_id)
  );

  CREATE TABLE quiz_attempts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    quiz_id    TEXT    NOT NULL CHECK (length(quiz_id) BETWEEN 1 AND 64),
    score      INTEGER NOT NULL CHECK (score >= 0),
    max_score  INTEGER NOT NULL CHECK (max_score >= 1 AND score <= max_score),
    passed     INTEGER NOT NULL CHECK (passed IN (0, 1)),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX idx_quiz_attempts_user ON quiz_attempts (user_id, quiz_id);
  "#,
  // v4: 3D Hardware Lab lessons completed, per account
  r#"
  CREATE TABLE lab_attempts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    lab_id     TEXT    NOT NULL CHECK (length(lab_id) BETWEEN 1 AND 64),
    mistakes   INTEGER NOT NULL CHECK (mistakes >= 0),
    hints      INTEGER NOT NULL CHECK (hints >= 0),
    duration_s INTEGER NOT NULL CHECK (duration_s >= 0),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX idx_lab_attempts_user ON lab_attempts (user_id, lab_id);
  "#,
];

pub fn open(path: &Path) -> AppResult<Connection> {
  let conn = Connection::open(path)?;
  initialize(&conn)?;
  Ok(conn)
}

pub fn initialize(conn: &Connection) -> AppResult<()> {
  conn.pragma_update(None, "foreign_keys", true)?;
  conn.busy_timeout(std::time::Duration::from_secs(5))?;
  migrate(conn)?;
  seed_default_admin(conn)?;
  Ok(())
}

pub fn schema_version(conn: &Connection) -> AppResult<usize> {
  let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
  Ok(version as usize)
}

fn migrate(conn: &Connection) -> AppResult<()> {
  let current = schema_version(conn)?;
  for (index, sql) in MIGRATIONS.iter().enumerate().skip(current) {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(sql)?;
    tx.pragma_update(None, "user_version", (index + 1) as i64)?;
    tx.commit()?;
    log::info!("database migrated to schema v{}", index + 1);
  }
  Ok(())
}

/// Creates the default administrator only when no accounts exist yet, so a
/// renamed or removed administrator is never silently recreated.
fn seed_default_admin(conn: &Connection) -> AppResult<()> {
  let user_count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;
  if user_count > 0 {
    return Ok(());
  }

  let hash = auth::hash_password(auth::DEFAULT_ADMIN_PASSWORD)?;
  conn.execute(
    "INSERT INTO users (username, password_hash, role, must_change_password)
     VALUES (?1, ?2, 'admin', 1)",
    (auth::DEFAULT_ADMIN_USERNAME, hash),
  )?;
  log::info!("created default administrator account");
  Ok(())
}
