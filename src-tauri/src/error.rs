use serde::ser::{Serialize, SerializeStruct, Serializer};

/// Errors returned to the frontend. Messages are safe to display as-is:
/// internal details are logged in the backend, never sent to the UI.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
  #[error("{}", invalid_credentials_message(*.0))]
  InvalidCredentials(i64),

  #[error("{}", locked_out_message(*.0))]
  LockedOut(i64),

  #[error("Your session has ended. Please sign in again.")]
  Unauthenticated,

  #[error("You must change your password before continuing.")]
  PasswordChangeRequired,

  #[error("{0}")]
  Validation(String),

  /// A problem with Ralp's local AI engine, described for the user.
  #[error("{0}")]
  Ai(String),

  #[error("A database error occurred. Please restart VocaTechX and try again.")]
  Database(#[from] rusqlite::Error),

  #[error("An unexpected error occurred. Please try again.")]
  Internal(String),
}

impl AppError {
  pub fn validation(message: impl Into<String>) -> Self {
    Self::Validation(message.into())
  }

  fn code(&self) -> &'static str {
    match self {
      Self::InvalidCredentials(_) => "invalid_credentials",
      Self::LockedOut(_) => "locked_out",
      Self::Unauthenticated => "unauthenticated",
      Self::PasswordChangeRequired => "password_change_required",
      Self::Validation(_) => "validation",
      Self::Ai(_) => "ai",
      Self::Database(_) => "database",
      Self::Internal(_) => "internal",
    }
  }
}

fn invalid_credentials_message(remaining_attempts: i64) -> String {
  match remaining_attempts {
    1 => "Invalid username or password. 1 attempt remaining before a temporary lock.".into(),
    n if n <= 3 => format!("Invalid username or password. {n} attempts remaining before a temporary lock."),
    _ => "Invalid username or password.".into(),
  }
}

fn locked_out_message(retry_after_seconds: i64) -> String {
  let minutes = (retry_after_seconds + 59) / 60;
  let unit = if minutes == 1 { "minute" } else { "minutes" };
  format!("Too many failed sign-in attempts. Try again in {minutes} {unit}.")
}

impl Serialize for AppError {
  fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
    match self {
      Self::Database(e) => log::error!("database error: {e}"),
      Self::Internal(e) => log::error!("internal error: {e}"),
      _ => {}
    }

    let retry_after = match self {
      Self::LockedOut(seconds) => Some(*seconds),
      _ => None,
    };

    let mut state = serializer.serialize_struct("AppError", 3)?;
    state.serialize_field("code", self.code())?;
    state.serialize_field("message", &self.to_string())?;
    state.serialize_field("retryAfterSeconds", &retry_after)?;
    state.end()
  }
}

pub type AppResult<T> = Result<T, AppError>;
