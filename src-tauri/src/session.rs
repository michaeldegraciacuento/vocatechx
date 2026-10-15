use std::sync::Mutex;

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// The signed-in user as exposed to the frontend. Never contains secrets.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
  pub id: i64,
  pub username: String,
  pub role: String,
  pub must_change_password: bool,
}

/// In-memory session for this app process. It is never written to disk, so
/// restarting VocaTechX always requires signing in again.
#[derive(Default)]
pub struct Session(Mutex<Option<SessionUser>>);

impl Session {
  pub fn current(&self) -> Option<SessionUser> {
    self.lock().clone()
  }

  pub fn start(&self, user: SessionUser) {
    *self.lock() = Some(user);
  }

  pub fn end(&self) {
    *self.lock() = None;
  }

  /// Signed in, but possibly still required to change the initial password.
  pub fn require_signed_in(&self) -> AppResult<SessionUser> {
    self.current().ok_or(AppError::Unauthenticated)
  }

  /// Signed in with full access to protected features.
  pub fn require_active(&self) -> AppResult<SessionUser> {
    let user = self.require_signed_in()?;
    if user.must_change_password {
      return Err(AppError::PasswordChangeRequired);
    }
    Ok(user)
  }

  fn lock(&self) -> std::sync::MutexGuard<'_, Option<SessionUser>> {
    // A poisoned lock only means another thread panicked mid-update; the
    // Option inside is still valid.
    self.0.lock().unwrap_or_else(|e| e.into_inner())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn user(must_change_password: bool) -> SessionUser {
    SessionUser {
      id: 1,
      username: "administrator".into(),
      role: "admin".into(),
      must_change_password,
    }
  }

  #[test]
  fn no_session_is_rejected() {
    let session = Session::default();
    assert!(matches!(session.require_signed_in(), Err(AppError::Unauthenticated)));
    assert!(matches!(session.require_active(), Err(AppError::Unauthenticated)));
  }

  #[test]
  fn pending_password_change_blocks_protected_access() {
    let session = Session::default();
    session.start(user(true));
    assert!(session.require_signed_in().is_ok());
    assert!(matches!(session.require_active(), Err(AppError::PasswordChangeRequired)));
  }

  #[test]
  fn active_session_is_allowed_until_ended() {
    let session = Session::default();
    session.start(user(false));
    assert!(session.require_active().is_ok());

    session.end();
    assert!(session.current().is_none());
    assert!(matches!(session.require_active(), Err(AppError::Unauthenticated)));
  }
}
