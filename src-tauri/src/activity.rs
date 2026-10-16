use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItem {
  pub id: i64,
  pub operation_type: String,
  pub title: String,
  pub status: String,
  pub summary: Option<String>,
  pub started_at: i64,
  pub finished_at: Option<i64>,
}

pub fn recent_activity(conn: &Connection, limit: u32) -> AppResult<Vec<ActivityItem>> {
  let mut stmt = conn.prepare(
    "SELECT id, operation_type, title, status, summary, started_at, finished_at
     FROM operation_runs
     ORDER BY started_at DESC, id DESC
     LIMIT ?1",
  )?;
  let items = stmt
    .query_map([limit], |row| {
      Ok(ActivityItem {
        id: row.get(0)?,
        operation_type: row.get(1)?,
        title: row.get(2)?,
        status: row.get(3)?,
        summary: row.get(4)?,
        started_at: row.get(5)?,
        finished_at: row.get(6)?,
      })
    })?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(items)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::db;

  fn memory_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    db::initialize(&conn).unwrap();
    conn
  }

  #[test]
  fn fresh_database_has_no_activity() {
    assert!(recent_activity(&memory_db(), 10).unwrap().is_empty());
  }

  #[test]
  fn returns_newest_first_up_to_limit() {
    let conn = memory_db();
    for (title, started_at) in [("Old", 100), ("Newest", 300), ("Middle", 200)] {
      conn
        .execute(
          "INSERT INTO operation_runs (operation_type, title, status, started_at)
           VALUES ('network_diagnostics', ?1, 'success', ?2)",
          (title, started_at),
        )
        .unwrap();
    }
    let titles: Vec<_> = recent_activity(&conn, 2).unwrap().into_iter().map(|i| i.title).collect();
    assert_eq!(titles, ["Newest", "Middle"]);
  }

  #[test]
  fn schema_rejects_invalid_status_and_deletes_logs_with_run() {
    let conn = memory_db();
    assert!(conn
      .execute(
        "INSERT INTO operation_runs (operation_type, title, status) VALUES ('x', 'y', 'bogus')",
        [],
      )
      .is_err());

    conn
      .execute("INSERT INTO operation_runs (operation_type, title) VALUES ('x', 'y')", [])
      .unwrap();
    let run_id = conn.last_insert_rowid();
    conn
      .execute(
        "INSERT INTO operation_logs (run_id, level, message) VALUES (?1, 'info', 'hello')",
        [run_id],
      )
      .unwrap();
    conn.execute("DELETE FROM operation_runs WHERE id = ?1", [run_id]).unwrap();
    let logs: i64 = conn.query_row("SELECT COUNT(*) FROM operation_logs", [], |r| r.get(0)).unwrap();
    assert_eq!(logs, 0);
  }
}
