//! CSS Learning Library progress: lessons started and completed, bookmarks and
//! quiz scores. Every query is scoped to the signed-in account.
//!
//! The lessons themselves are bundled with the frontend, so the backend only
//! checks that IDs are well-formed and scores are in range.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonProgress {
  pub lesson_id: String,
  pub lesson_version: i64,
  pub last_step: i64,
  pub started_at: i64,
  pub completed_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizBest {
  pub quiz_id: String,
  pub best_score: i64,
  pub max_score: i64,
  pub passed: bool,
  pub attempts: i64,
  pub last_attempt_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabBest {
  pub lab_id: String,
  pub completions: i64,
  /// The fewest mistakes in any completed run.
  pub best_mistakes: i64,
  pub last_completed_at: i64,
}

/// Everything the Learning Library shows for one account, in one call.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningState {
  pub progress: Vec<LessonProgress>,
  pub bookmarks: Vec<String>,
  pub quizzes: Vec<QuizBest>,
  pub labs: Vec<LabBest>,
}

/// Lesson and quiz IDs are lowercase slugs, e.g. `esd-safety-basics`.
pub fn validate_id(id: &str) -> AppResult<&str> {
  let ok = !id.is_empty()
    && id.len() <= 64
    && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    && !id.starts_with('-')
    && !id.ends_with('-');
  if ok { Ok(id) } else { Err(AppError::validation("That lesson could not be found.")) }
}

pub fn state(conn: &Connection, user_id: i64) -> AppResult<LearningState> {
  let progress = conn
    .prepare(
      "SELECT lesson_id, lesson_version, last_step, started_at, completed_at
       FROM learning_progress WHERE user_id = ?1",
    )?
    .query_map([user_id], |r| {
      Ok(LessonProgress {
        lesson_id: r.get(0)?,
        lesson_version: r.get(1)?,
        last_step: r.get(2)?,
        started_at: r.get(3)?,
        completed_at: r.get(4)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;

  let bookmarks = conn
    .prepare("SELECT lesson_id FROM learning_bookmarks WHERE user_id = ?1 ORDER BY created_at DESC")?
    .query_map([user_id], |r| r.get(0))?
    .collect::<Result<Vec<String>, _>>()?;

  // The best attempt per quiz: highest score, then most recent.
  let quizzes = conn
    .prepare(
      "SELECT quiz_id, MAX(score), max_score, MAX(passed), COUNT(*), MAX(created_at)
       FROM quiz_attempts WHERE user_id = ?1 GROUP BY quiz_id",
    )?
    .query_map([user_id], |r| {
      Ok(QuizBest {
        quiz_id: r.get(0)?,
        best_score: r.get(1)?,
        max_score: r.get(2)?,
        passed: r.get::<_, i64>(3)? == 1,
        attempts: r.get(4)?,
        last_attempt_at: r.get(5)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;

  let labs = conn
    .prepare(
      "SELECT lab_id, COUNT(*), MIN(mistakes), MAX(created_at)
       FROM lab_attempts WHERE user_id = ?1 GROUP BY lab_id",
    )?
    .query_map([user_id], |r| {
      Ok(LabBest { lab_id: r.get(0)?, completions: r.get(1)?, best_mistakes: r.get(2)?, last_completed_at: r.get(3)? })
    })?
    .collect::<Result<Vec<_>, _>>()?;

  Ok(LearningState { progress, bookmarks, quizzes, labs })
}

/// Records a completed 3D lab lesson.
pub fn record_lab(conn: &Connection, user_id: i64, lab_id: &str, mistakes: i64, hints: i64, duration_s: i64) -> AppResult<()> {
  let lab_id = validate_id(lab_id)?;
  if !(0..=10_000).contains(&mistakes) || !(0..=10_000).contains(&hints) || !(0..=86_400).contains(&duration_s) {
    return Err(AppError::validation("That lab result is not valid."));
  }
  conn.execute(
    "INSERT INTO lab_attempts (user_id, lab_id, mistakes, hints, duration_s) VALUES (?1, ?2, ?3, ?4, ?5)",
    params![user_id, lab_id, mistakes, hints, duration_s],
  )?;
  Ok(())
}

/// Records how far the user got in a lesson. Completing it is permanent:
/// revisiting a completed lesson updates the step but keeps it completed.
pub fn update_progress(
  conn: &Connection,
  user_id: i64,
  lesson_id: &str,
  lesson_version: i64,
  last_step: i64,
  completed: bool,
  now: i64,
) -> AppResult<()> {
  let lesson_id = validate_id(lesson_id)?;
  if !(1..=10_000).contains(&lesson_version) || !(0..=500).contains(&last_step) {
    return Err(AppError::validation("That lesson step is not valid."));
  }
  conn.execute(
    "INSERT INTO learning_progress (user_id, lesson_id, lesson_version, last_step, started_at, completed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, CASE WHEN ?6 THEN ?5 END)
     ON CONFLICT (user_id, lesson_id) DO UPDATE SET
       lesson_version = excluded.lesson_version,
       last_step      = excluded.last_step,
       completed_at   = COALESCE(learning_progress.completed_at, CASE WHEN ?6 THEN ?5 END)",
    params![user_id, lesson_id, lesson_version, last_step, now, completed],
  )?;
  Ok(())
}

pub fn set_bookmark(conn: &Connection, user_id: i64, lesson_id: &str, bookmarked: bool) -> AppResult<()> {
  let lesson_id = validate_id(lesson_id)?;
  if bookmarked {
    conn.execute(
      "INSERT OR IGNORE INTO learning_bookmarks (user_id, lesson_id) VALUES (?1, ?2)",
      params![user_id, lesson_id],
    )?;
  } else {
    conn.execute("DELETE FROM learning_bookmarks WHERE user_id = ?1 AND lesson_id = ?2", params![user_id, lesson_id])?;
  }
  Ok(())
}

pub fn record_quiz(conn: &Connection, user_id: i64, quiz_id: &str, score: i64, max_score: i64, passed: bool) -> AppResult<()> {
  let quiz_id = validate_id(quiz_id)?;
  if !(1..=200).contains(&max_score) || !(0..=max_score).contains(&score) {
    return Err(AppError::validation("That quiz score is not valid."));
  }
  conn.execute(
    "INSERT INTO quiz_attempts (user_id, quiz_id, score, max_score, passed) VALUES (?1, ?2, ?3, ?4, ?5)",
    params![user_id, quiz_id, score, max_score, passed],
  )?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db;

  fn setup() -> (Connection, i64) {
    let conn = Connection::open_in_memory().unwrap();
    db::initialize(&conn).unwrap();
    let user_id = conn.query_row("SELECT id FROM users", [], |r| r.get(0)).unwrap();
    (conn, user_id)
  }

  fn second_user(conn: &Connection) -> i64 {
    conn
      .execute("INSERT INTO users (username, password_hash, role) VALUES ('tech', '$argon2id$test', 'technician')", [])
      .unwrap();
    conn.last_insert_rowid()
  }

  #[test]
  fn ids_are_slugs() {
    assert!(validate_id("esd-safety-basics").is_ok());
    assert!(validate_id("ram-ddr4").is_ok());
    for bad in ["", "Has-Caps", "a b", "../x", "-start", "end-", &"x".repeat(65)] {
      assert!(validate_id(bad).is_err(), "{bad}");
    }
  }

  #[test]
  fn progress_moves_forward_and_completion_sticks() {
    let (conn, user) = setup();
    update_progress(&conn, user, "esd-safety-basics", 1, 2, false, 100).unwrap();
    let s = state(&conn, user).unwrap();
    assert_eq!(s.progress[0].last_step, 2);
    assert!(s.progress[0].completed_at.is_none());

    update_progress(&conn, user, "esd-safety-basics", 1, 5, true, 200).unwrap();
    // Revisiting later keeps the original completion time.
    update_progress(&conn, user, "esd-safety-basics", 1, 1, false, 300).unwrap();
    let p = &state(&conn, user).unwrap().progress[0];
    assert_eq!((p.last_step, p.started_at, p.completed_at), (1, 100, Some(200)));
  }

  #[test]
  fn bookmarks_toggle() {
    let (conn, user) = setup();
    set_bookmark(&conn, user, "ram-install", true).unwrap();
    set_bookmark(&conn, user, "ram-install", true).unwrap();
    assert_eq!(state(&conn, user).unwrap().bookmarks, ["ram-install"]);
    set_bookmark(&conn, user, "ram-install", false).unwrap();
    assert!(state(&conn, user).unwrap().bookmarks.is_empty());
  }

  #[test]
  fn quiz_keeps_best_score_and_rejects_bad_scores() {
    let (conn, user) = setup();
    record_quiz(&conn, user, "esd-quiz", 3, 5, false).unwrap();
    record_quiz(&conn, user, "esd-quiz", 5, 5, true).unwrap();
    record_quiz(&conn, user, "esd-quiz", 4, 5, true).unwrap();
    let q = &state(&conn, user).unwrap().quizzes[0];
    assert_eq!((q.best_score, q.max_score, q.passed, q.attempts), (5, 5, true, 3));

    assert!(record_quiz(&conn, user, "esd-quiz", 6, 5, true).is_err());
    assert!(record_quiz(&conn, user, "esd-quiz", -1, 5, false).is_err());
    assert!(record_quiz(&conn, user, "esd-quiz", 0, 0, false).is_err());
  }

  #[test]
  fn lab_results_keep_fewest_mistakes() {
    let (conn, user) = setup();
    record_lab(&conn, user, "lab-ram", 3, 1, 240).unwrap();
    record_lab(&conn, user, "lab-ram", 0, 0, 180).unwrap();
    let lab = &state(&conn, user).unwrap().labs[0];
    assert_eq!((lab.lab_id.as_str(), lab.completions, lab.best_mistakes), ("lab-ram", 2, 0));
    assert!(record_lab(&conn, user, "lab-ram", -1, 0, 10).is_err());
    assert!(record_lab(&conn, user, "Lab RAM", 0, 0, 10).is_err());
  }

  #[test]
  fn each_account_sees_only_its_own_progress() {
    let (conn, admin) = setup();
    let tech = second_user(&conn);
    update_progress(&conn, admin, "esd-safety-basics", 1, 0, true, 100).unwrap();
    set_bookmark(&conn, admin, "esd-safety-basics", true).unwrap();
    record_quiz(&conn, admin, "esd-quiz", 5, 5, true).unwrap();

    let other = state(&conn, tech).unwrap();
    assert!(other.progress.is_empty() && other.bookmarks.is_empty() && other.quizzes.is_empty());
  }
}
