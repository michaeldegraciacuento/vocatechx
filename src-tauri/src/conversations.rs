//! Storage for Ralp conversations. Every query is scoped to the owning user.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const MAX_MESSAGE_CHARS: usize = 4000;
const TITLE_CHARS: usize = 60;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
  pub id: i64,
  pub title: String,
  pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
  pub id: i64,
  pub role: String,
  pub content: String,
  pub created_at: i64,
}

pub fn validate_message(message: &str) -> AppResult<&str> {
  let message = message.trim();
  if message.is_empty() {
    return Err(AppError::validation("Type a message for Ralp first."));
  }
  if message.chars().count() > MAX_MESSAGE_CHARS {
    return Err(AppError::validation(format!(
      "Messages can be at most {MAX_MESSAGE_CHARS} characters."
    )));
  }
  Ok(message)
}

fn title_from(message: &str) -> String {
  let first_line = message.lines().next().unwrap_or(message).trim();
  let mut title: String = first_line.chars().take(TITLE_CHARS).collect();
  if first_line.chars().count() > TITLE_CHARS {
    title = format!("{}…", title.trim_end());
  }
  if title.is_empty() { "New conversation".into() } else { title }
}

/// Creates a conversation and a matching entry in the activity log.
pub fn create(conn: &Connection, user_id: i64, first_message: &str) -> AppResult<i64> {
  let title = title_from(first_message);
  let tx = conn.unchecked_transaction()?;
  tx.execute(
    "INSERT INTO operation_runs (operation_type, title, status, summary, finished_at, user_id)
     VALUES ('ai_troubleshooter', ?1, 'success', 'Troubleshooting with Ralp', unixepoch(), ?2)",
    (&title, user_id),
  )?;
  let run_id = tx.last_insert_rowid();
  tx.execute(
    "INSERT INTO ai_conversations (user_id, title, operation_run_id) VALUES (?1, ?2, ?3)",
    (user_id, &title, run_id),
  )?;
  let id = tx.last_insert_rowid();
  tx.commit()?;
  Ok(id)
}

pub fn ensure_owned(conn: &Connection, user_id: i64, conversation_id: i64) -> AppResult<()> {
  conn
    .query_row(
      "SELECT 1 FROM ai_conversations WHERE id = ?1 AND user_id = ?2",
      (conversation_id, user_id),
      |_| Ok(()),
    )
    .optional()?
    .ok_or_else(|| AppError::validation("That conversation no longer exists."))
}

pub fn list(conn: &Connection, user_id: i64) -> AppResult<Vec<ConversationSummary>> {
  let mut stmt = conn.prepare(
    "SELECT id, title, updated_at FROM ai_conversations
     WHERE user_id = ?1 ORDER BY updated_at DESC, id DESC LIMIT 100",
  )?;
  let rows = stmt
    .query_map([user_id], |row| {
      Ok(ConversationSummary { id: row.get(0)?, title: row.get(1)?, updated_at: row.get(2)? })
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

pub fn messages(conn: &Connection, user_id: i64, conversation_id: i64) -> AppResult<Vec<ChatMessage>> {
  ensure_owned(conn, user_id, conversation_id)?;
  let mut stmt = conn.prepare(
    "SELECT id, role, content, created_at FROM ai_messages
     WHERE conversation_id = ?1 ORDER BY id",
  )?;
  let rows = stmt
    .query_map([conversation_id], |row| {
      Ok(ChatMessage { id: row.get(0)?, role: row.get(1)?, content: row.get(2)?, created_at: row.get(3)? })
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(rows)
}

pub fn add_message(conn: &Connection, conversation_id: i64, role: &str, content: &str) -> AppResult<ChatMessage> {
  let tx = conn.unchecked_transaction()?;
  let message = tx.query_row(
    "INSERT INTO ai_messages (conversation_id, role, content) VALUES (?1, ?2, ?3)
     RETURNING id, role, content, created_at",
    (conversation_id, role, content),
    |row| Ok(ChatMessage { id: row.get(0)?, role: row.get(1)?, content: row.get(2)?, created_at: row.get(3)? }),
  )?;
  tx.execute(
    "UPDATE ai_conversations SET updated_at = unixepoch() WHERE id = ?1",
    [conversation_id],
  )?;
  tx.commit()?;
  Ok(message)
}

/// Removes the conversation and its activity entry.
pub fn delete(conn: &Connection, user_id: i64, conversation_id: i64) -> AppResult<()> {
  ensure_owned(conn, user_id, conversation_id)?;
  let tx = conn.unchecked_transaction()?;
  tx.execute(
    "DELETE FROM operation_runs WHERE id = (SELECT operation_run_id FROM ai_conversations WHERE id = ?1)",
    [conversation_id],
  )?;
  tx.execute("DELETE FROM ai_conversations WHERE id = ?1", [conversation_id])?;
  tx.commit()?;
  Ok(())
}

/// The most recent messages that fit in `max_chars`, oldest first, so the
/// prompt stays within the model's context window.
pub fn recent_history(all: &[ChatMessage], max_chars: usize) -> &[ChatMessage] {
  let mut used = 0;
  let mut start = all.len();
  for (index, message) in all.iter().enumerate().rev() {
    used += message.content.chars().count();
    if used > max_chars && start < all.len() {
      break;
    }
    start = index;
  }
  &all[start..]
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

  fn message(id: i64, content: &str) -> ChatMessage {
    ChatMessage { id, role: "user".into(), content: content.into(), created_at: 0 }
  }

  #[test]
  fn creating_a_conversation_logs_activity() {
    let (conn, user) = setup();
    let id = create(&conn, user, "Printer shows offline\nIt's a USB Epson").unwrap();
    add_message(&conn, id, "user", "Printer shows offline").unwrap();

    let list = list(&conn, user).unwrap();
    assert_eq!(list[0].title, "Printer shows offline");
    let activity = crate::activity::recent_activity(&conn, 10).unwrap();
    assert_eq!(activity[0].operation_type, "ai_troubleshooter");
    assert_eq!(activity[0].title, "Printer shows offline");
  }

  #[test]
  fn long_titles_are_truncated() {
    assert_eq!(title_from(&"a".repeat(80)).chars().count(), TITLE_CHARS + 1);
  }

  #[test]
  fn other_users_cannot_read_or_delete() {
    let (conn, user) = setup();
    let id = create(&conn, user, "hello").unwrap();
    assert!(messages(&conn, user + 99, id).is_err());
    assert!(delete(&conn, user + 99, id).is_err());
    assert!(messages(&conn, user, id).is_ok());
  }

  #[test]
  fn delete_removes_messages_and_activity() {
    let (conn, user) = setup();
    let id = create(&conn, user, "hello").unwrap();
    add_message(&conn, id, "user", "hello").unwrap();
    delete(&conn, user, id).unwrap();

    let remaining: i64 = conn.query_row("SELECT COUNT(*) FROM ai_messages", [], |r| r.get(0)).unwrap();
    assert_eq!(remaining, 0);
    assert!(crate::activity::recent_activity(&conn, 10).unwrap().is_empty());
  }

  #[test]
  fn message_validation() {
    assert!(validate_message("   ").is_err());
    assert!(validate_message(&"x".repeat(MAX_MESSAGE_CHARS + 1)).is_err());
    assert_eq!(validate_message("  hi  ").unwrap(), "hi");
  }

  #[test]
  fn history_keeps_newest_messages_within_budget() {
    let all = [message(1, "aaaaaaaaaa"), message(2, "bbbbbbbbbb"), message(3, "cccccccccc")];
    let ids: Vec<_> = recent_history(&all, 25).iter().map(|m| m.id).collect();
    assert_eq!(ids, [2, 3]);
    // The newest message is always kept, even if it alone exceeds the budget.
    assert_eq!(recent_history(&all, 5).len(), 1);
  }
}
