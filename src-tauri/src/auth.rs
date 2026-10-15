use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rusqlite::{Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::session::SessionUser;

pub const DEFAULT_ADMIN_USERNAME: &str = "administrator";
pub const DEFAULT_ADMIN_PASSWORD: &str = "password";

pub const MAX_FAILED_ATTEMPTS: i64 = 5;
pub const LOCKOUT_SECONDS: i64 = 5 * 60;
/// Failures older than this no longer count toward a lockout.
pub const FAILURE_WINDOW_SECONDS: i64 = 15 * 60;

const MAX_USERNAME_LEN: usize = 64;
const MIN_PASSWORD_LEN: usize = 8;
const MAX_PASSWORD_LEN: usize = 128;

pub fn now() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs() as i64)
    .unwrap_or_default()
}

/// Hashes with Argon2id (v19, m=19 MiB, t=2, p=1) and a random salt,
/// producing a self-describing PHC string.
pub fn hash_password(password: &str) -> AppResult<String> {
  let salt = SaltString::generate(&mut OsRng);
  Argon2::default()
    .hash_password(password.as_bytes(), &salt)
    .map(|hash| hash.to_string())
    .map_err(|e| AppError::Internal(format!("password hashing failed: {e}")))
}

fn verify_password(password: &str, stored_hash: &str) -> bool {
  PasswordHash::new(stored_hash)
    .and_then(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed))
    .is_ok()
}

/// Verifying against this when the username does not exist keeps the
/// response time the same, so timing does not reveal which accounts exist.
fn dummy_hash() -> &'static str {
  static DUMMY: OnceLock<String> = OnceLock::new();
  DUMMY.get_or_init(|| hash_password("vocatechx-timing-equalizer").unwrap_or_default())
}

struct UserRecord {
  user: SessionUser,
  password_hash: String,
}

fn find_user_by_username(conn: &Connection, username: &str) -> AppResult<Option<UserRecord>> {
  Ok(conn
    .query_row(
      "SELECT id, username, role, must_change_password, password_hash
       FROM users WHERE username = ?1",
      [username],
      map_user_record,
    )
    .optional()?)
}

fn find_user_by_id(conn: &Connection, id: i64) -> AppResult<Option<UserRecord>> {
  Ok(conn
    .query_row(
      "SELECT id, username, role, must_change_password, password_hash
       FROM users WHERE id = ?1",
      [id],
      map_user_record,
    )
    .optional()?)
}

fn map_user_record(row: &rusqlite::Row) -> rusqlite::Result<UserRecord> {
  Ok(UserRecord {
    user: SessionUser {
      id: row.get(0)?,
      username: row.get(1)?,
      role: row.get(2)?,
      must_change_password: row.get(3)?,
    },
    password_hash: row.get(4)?,
  })
}

pub fn login(conn: &Connection, username: &str, password: &str, now: i64) -> AppResult<SessionUser> {
  let username = username.trim();
  if username.is_empty() && password.is_empty() {
    return Err(AppError::validation("Enter your username and password."));
  }
  if username.is_empty() {
    return Err(AppError::validation("Enter your username."));
  }
  if password.is_empty() {
    return Err(AppError::validation("Enter your password."));
  }
  if username.chars().count() > MAX_USERNAME_LEN || password.chars().count() > MAX_PASSWORD_LEN {
    return Err(AppError::InvalidCredentials(remaining_attempts(conn, username, now)?));
  }

  if let Some(retry_after) = lockout_remaining(conn, username, now)? {
    return Err(AppError::LockedOut(retry_after));
  }

  let record = find_user_by_username(conn, username)?;
  let valid = match &record {
    Some(record) => verify_password(password, &record.password_hash),
    None => {
      verify_password(password, dummy_hash());
      false
    }
  };

  match record {
    Some(record) if valid => {
      conn.execute("DELETE FROM login_throttle WHERE username = ?1", [username])?;
      Ok(record.user)
    }
    _ => Err(record_failure(conn, username, now)?),
  }
}

fn lockout_remaining(conn: &Connection, username: &str, now: i64) -> AppResult<Option<i64>> {
  let locked_until: Option<i64> = conn
    .query_row(
      "SELECT locked_until FROM login_throttle WHERE username = ?1",
      [username],
      |row| row.get(0),
    )
    .optional()?
    .flatten();
  Ok(locked_until.filter(|until| *until > now).map(|until| until - now))
}

fn remaining_attempts(conn: &Connection, username: &str, now: i64) -> AppResult<i64> {
  let failed: i64 = conn
    .query_row(
      "SELECT failed_attempts FROM login_throttle
       WHERE username = ?1 AND last_failed_at > ?2",
      (username, now - FAILURE_WINDOW_SECONDS),
      |row| row.get(0),
    )
    .optional()?
    .unwrap_or(0);
  Ok((MAX_FAILED_ATTEMPTS - failed).max(0))
}

/// Records a failed attempt and returns the error to report: a lockout once
/// the limit is reached, otherwise invalid credentials with attempts left.
fn record_failure(conn: &Connection, username: &str, now: i64) -> AppResult<AppError> {
  let failed: i64 = conn.query_row(
    "INSERT INTO login_throttle (username, failed_attempts, last_failed_at, locked_until)
     VALUES (?1, 1, ?2, NULL)
     ON CONFLICT (username) DO UPDATE SET
       failed_attempts = CASE
         WHEN last_failed_at <= ?2 - ?3 OR locked_until IS NOT NULL THEN 1
         ELSE failed_attempts + 1
       END,
       last_failed_at = ?2,
       locked_until = NULL
     RETURNING failed_attempts",
    (username, now, FAILURE_WINDOW_SECONDS),
    |row| row.get(0),
  )?;

  if failed >= MAX_FAILED_ATTEMPTS {
    conn.execute(
      "UPDATE login_throttle SET locked_until = ?2 WHERE username = ?1",
      (username, now + LOCKOUT_SECONDS),
    )?;
    log::warn!("sign-in temporarily locked after {failed} failed attempts");
    return Ok(AppError::LockedOut(LOCKOUT_SECONDS));
  }

  Ok(AppError::InvalidCredentials(MAX_FAILED_ATTEMPTS - failed))
}

pub fn validate_new_password(
  username: &str,
  current_password: &str,
  new_password: &str,
  confirm_password: &str,
) -> AppResult<()> {
  let length = new_password.chars().count();
  if length < MIN_PASSWORD_LEN {
    return Err(AppError::validation(format!(
      "New password must be at least {MIN_PASSWORD_LEN} characters."
    )));
  }
  if length > MAX_PASSWORD_LEN {
    return Err(AppError::validation(format!(
      "New password must be at most {MAX_PASSWORD_LEN} characters."
    )));
  }
  if !new_password.chars().any(char::is_alphabetic) || !new_password.chars().any(|c| c.is_ascii_digit()) {
    return Err(AppError::validation("New password must contain at least one letter and one number."));
  }
  if new_password == current_password {
    return Err(AppError::validation("New password must be different from your current password."));
  }
  if new_password.eq_ignore_ascii_case(DEFAULT_ADMIN_PASSWORD) || new_password.eq_ignore_ascii_case(username) {
    return Err(AppError::validation("Choose a password that is harder to guess."));
  }
  if new_password != confirm_password {
    return Err(AppError::validation("New password and confirmation do not match."));
  }
  Ok(())
}

pub fn change_password(
  conn: &Connection,
  user_id: i64,
  current_password: &str,
  new_password: &str,
  confirm_password: &str,
) -> AppResult<SessionUser> {
  let record = find_user_by_id(conn, user_id)?.ok_or(AppError::Unauthenticated)?;

  if current_password.is_empty() {
    return Err(AppError::validation("Enter your current password."));
  }
  if !verify_password(current_password, &record.password_hash) {
    return Err(AppError::validation("Current password is incorrect."));
  }
  validate_new_password(&record.user.username, current_password, new_password, confirm_password)?;

  let hash = hash_password(new_password)?;
  conn.execute(
    "UPDATE users
     SET password_hash = ?2, must_change_password = 0, updated_at = unixepoch()
     WHERE id = ?1",
    (user_id, hash),
  )?;

  Ok(SessionUser {
    must_change_password: false,
    ..record.user
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db;

  const T0: i64 = 1_800_000_000;
  const NEW_PASSWORD: &str = "Vocatechx2026";

  fn memory_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    db::initialize(&conn).unwrap();
    conn
  }

  fn admin_login(conn: &Connection, password: &str, now: i64) -> AppResult<SessionUser> {
    login(conn, DEFAULT_ADMIN_USERNAME, password, now)
  }

  #[test]
  fn first_run_creates_admin_requiring_password_change() {
    let conn = memory_db();
    let (role, must_change, hash): (String, bool, String) = conn
      .query_row(
        "SELECT role, must_change_password, password_hash FROM users WHERE username = ?1",
        [DEFAULT_ADMIN_USERNAME],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
      )
      .unwrap();

    assert_eq!(role, "admin");
    assert!(must_change);
    assert!(hash.starts_with("$argon2id$"));
    assert!(!hash.contains(DEFAULT_ADMIN_PASSWORD));
  }

  #[test]
  fn initialization_is_idempotent() {
    let conn = memory_db();
    db::initialize(&conn).unwrap();
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1);
    assert_eq!(db::schema_version(&conn).unwrap(), 2);
  }

  #[test]
  fn correct_credentials_sign_in() {
    let conn = memory_db();
    let user = admin_login(&conn, DEFAULT_ADMIN_PASSWORD, T0).unwrap();
    assert_eq!(user.username, DEFAULT_ADMIN_USERNAME);
    assert!(user.must_change_password);
  }

  #[test]
  fn username_is_case_insensitive_and_trimmed() {
    let conn = memory_db();
    assert!(login(&conn, "  Administrator ", DEFAULT_ADMIN_PASSWORD, T0).is_ok());
  }

  #[test]
  fn wrong_password_and_unknown_user_are_indistinguishable() {
    let conn = memory_db();
    let wrong = admin_login(&conn, "nope", T0).unwrap_err();
    let unknown = login(&conn, "ghost", "nope", T0).unwrap_err();
    assert_eq!(wrong.to_string(), unknown.to_string());
    assert!(matches!(wrong, AppError::InvalidCredentials(4)));
  }

  #[test]
  fn empty_inputs_are_validation_errors_and_not_counted() {
    let conn = memory_db();
    assert!(matches!(admin_login(&conn, "", T0), Err(AppError::Validation(_))));
    assert!(matches!(login(&conn, "  ", "x", T0), Err(AppError::Validation(_))));
    assert_eq!(remaining_attempts(&conn, DEFAULT_ADMIN_USERNAME, T0).unwrap(), MAX_FAILED_ATTEMPTS);
  }

  #[test]
  fn repeated_failures_lock_then_expire() {
    let conn = memory_db();
    for _ in 0..MAX_FAILED_ATTEMPTS - 1 {
      assert!(matches!(admin_login(&conn, "wrong", T0), Err(AppError::InvalidCredentials(_))));
    }
    assert!(matches!(admin_login(&conn, "wrong", T0), Err(AppError::LockedOut(LOCKOUT_SECONDS))));

    // Even the correct password is refused while locked.
    assert!(matches!(
      admin_login(&conn, DEFAULT_ADMIN_PASSWORD, T0 + 10),
      Err(AppError::LockedOut(s)) if s == LOCKOUT_SECONDS - 10
    ));

    // After the lock expires, the correct password works and clears the counter.
    assert!(admin_login(&conn, DEFAULT_ADMIN_PASSWORD, T0 + LOCKOUT_SECONDS).is_ok());
    assert_eq!(remaining_attempts(&conn, DEFAULT_ADMIN_USERNAME, T0 + LOCKOUT_SECONDS).unwrap(), MAX_FAILED_ATTEMPTS);
  }

  #[test]
  fn failed_attempt_after_lock_expiry_starts_a_fresh_count() {
    let conn = memory_db();
    for _ in 0..MAX_FAILED_ATTEMPTS {
      let _ = admin_login(&conn, "wrong", T0);
    }
    let later = T0 + LOCKOUT_SECONDS;
    assert!(matches!(admin_login(&conn, "wrong", later), Err(AppError::InvalidCredentials(4))));
  }

  #[test]
  fn old_failures_outside_the_window_do_not_count() {
    let conn = memory_db();
    for _ in 0..MAX_FAILED_ATTEMPTS - 1 {
      let _ = admin_login(&conn, "wrong", T0);
    }
    let later = T0 + FAILURE_WINDOW_SECONDS + 1;
    assert!(matches!(admin_login(&conn, "wrong", later), Err(AppError::InvalidCredentials(4))));
  }

  #[test]
  fn unknown_usernames_are_throttled_too() {
    let conn = memory_db();
    for _ in 0..MAX_FAILED_ATTEMPTS - 1 {
      let _ = login(&conn, "ghost", "x", T0);
    }
    assert!(matches!(login(&conn, "ghost", "x", T0), Err(AppError::LockedOut(_))));
  }

  #[test]
  fn lockout_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(db::DATABASE_FILE);
    {
      let conn = db::open(&path).unwrap();
      for _ in 0..MAX_FAILED_ATTEMPTS {
        let _ = admin_login(&conn, "wrong", T0);
      }
    }
    let conn = db::open(&path).unwrap();
    assert!(matches!(admin_login(&conn, DEFAULT_ADMIN_PASSWORD, T0 + 1), Err(AppError::LockedOut(_))));
  }

  #[test]
  fn first_login_password_change_flow() {
    let conn = memory_db();
    let user = admin_login(&conn, DEFAULT_ADMIN_PASSWORD, T0).unwrap();

    let updated = change_password(&conn, user.id, DEFAULT_ADMIN_PASSWORD, NEW_PASSWORD, NEW_PASSWORD).unwrap();
    assert!(!updated.must_change_password);

    assert!(matches!(admin_login(&conn, DEFAULT_ADMIN_PASSWORD, T0), Err(AppError::InvalidCredentials(_))));
    let relogin = admin_login(&conn, NEW_PASSWORD, T0).unwrap();
    assert!(!relogin.must_change_password);
  }

  #[test]
  fn password_change_persists_across_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(db::DATABASE_FILE);
    {
      let conn = db::open(&path).unwrap();
      let user = admin_login(&conn, DEFAULT_ADMIN_PASSWORD, T0).unwrap();
      change_password(&conn, user.id, DEFAULT_ADMIN_PASSWORD, NEW_PASSWORD, NEW_PASSWORD).unwrap();
    }
    let conn = db::open(&path).unwrap();
    let user = admin_login(&conn, NEW_PASSWORD, T0).unwrap();
    assert!(!user.must_change_password);
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1, "restart must not re-seed the administrator");
  }

  #[test]
  fn password_change_rejects_wrong_current_password() {
    let conn = memory_db();
    let user = admin_login(&conn, DEFAULT_ADMIN_PASSWORD, T0).unwrap();
    let err = change_password(&conn, user.id, "wrong", NEW_PASSWORD, NEW_PASSWORD).unwrap_err();
    assert_eq!(err.to_string(), "Current password is incorrect.");
  }

  #[test]
  fn new_password_rules() {
    let check = |new: &str, confirm: &str| validate_new_password("administrator", "Current123", new, confirm);
    assert!(check("short1", "short1").is_err());
    assert!(check("lettersonly", "lettersonly").is_err());
    assert!(check("12345678", "12345678").is_err());
    assert!(check("Current123", "Current123").is_err());
    assert!(check("PASSWORD", "PASSWORD").is_err());
    assert!(check("Vocatechx2026", "Vocatechx2027").is_err());
    assert!(check(&"a1".repeat(65), &"a1".repeat(65)).is_err());
    assert!(check("Vocatechx2026", "Vocatechx2026").is_ok());
  }

  #[test]
  fn errors_serialize_without_internal_details() {
    let json = serde_json::to_value(AppError::Internal("secret path C:\\x".into())).unwrap();
    assert_eq!(json["code"], "internal");
    assert!(!json["message"].as_str().unwrap().contains("secret"));

    let locked = serde_json::to_value(AppError::LockedOut(90)).unwrap();
    assert_eq!(locked["retryAfterSeconds"], 90);
    assert_eq!(locked["message"], "Too many failed sign-in attempts. Try again in 2 minutes.");
  }
}
