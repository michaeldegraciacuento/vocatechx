//! Network Center history: every test and repair is saved as an operation run
//! with its log lines in the local database, and can be exported as a TXT or
//! PDF report.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::activity::ActivityItem;
use crate::error::{AppError, AppResult};

/// Operation types written by Network Center.
pub const OPERATION_TYPES: &[&str] = &["network_diagnostics", "network_repair", "network_performance", "dns_test", "file_sharing", "wifi_password"];

/// Operation types written by the Printer & Devices module. History and reports
/// for the two modules are kept separate by filtering on these lists, but both
/// reuse this one storage, export and PDF code.
pub const DEVICE_OPERATION_TYPES: &[&str] = &["printer_repair", "spooler_repair", "print_queue", "printer_diagnostics", "device_scan"];

/// Operation types written by the Software Center.
pub const SOFTWARE_OPERATION_TYPES: &[&str] = &["software_install", "software_uninstall"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
  Info,
  Warning,
  Error,
}

impl Level {
  fn as_str(self) -> &'static str {
    match self {
      Self::Info => "info",
      Self::Warning => "warning",
      Self::Error => "error",
    }
  }
}

#[derive(Debug, Clone)]
pub struct LogLine {
  pub level: Level,
  pub message: String,
}

impl LogLine {
  pub fn new(level: Level, message: impl Into<String>) -> Self {
    Self { level, message: message.into() }
  }
}

pub struct NewRun<'a> {
  pub user_id: i64,
  pub operation_type: &'static str,
  pub title: &'a str,
  /// `success`, `failed` or `cancelled`.
  pub status: &'static str,
  pub summary: &'a str,
  pub started_at: i64,
  pub finished_at: i64,
  pub logs: &'a [LogLine],
}

pub fn record(conn: &Connection, run: NewRun<'_>) -> AppResult<i64> {
  debug_assert!([OPERATION_TYPES, DEVICE_OPERATION_TYPES, SOFTWARE_OPERATION_TYPES].iter().any(|types| types.contains(&run.operation_type)));
  let tx = conn.unchecked_transaction()?;
  tx.execute(
    "INSERT INTO operation_runs (operation_type, title, status, summary, started_at, finished_at, user_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    params![
      run.operation_type,
      run.title,
      run.status,
      run.summary,
      run.started_at,
      run.finished_at.max(run.started_at),
      run.user_id
    ],
  )?;
  let run_id = tx.last_insert_rowid();
  {
    let mut insert = tx.prepare("INSERT INTO operation_logs (run_id, level, message, created_at) VALUES (?1, ?2, ?3, ?4)")?;
    for line in run.logs {
      insert.execute(params![run_id, line.level.as_str(), line.message, run.finished_at])?;
    }
  }
  tx.commit()?;
  Ok(run_id)
}

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActivityItem> {
  Ok(ActivityItem {
    id: row.get(0)?,
    operation_type: row.get(1)?,
    title: row.get(2)?,
    status: row.get(3)?,
    summary: row.get(4)?,
    started_at: row.get(5)?,
    finished_at: row.get(6)?,
  })
}

pub fn history(conn: &Connection, types: &[&str], limit: u32) -> AppResult<Vec<ActivityItem>> {
  let placeholders = vec!["?"; types.len()].join(", ");
  let mut stmt = conn.prepare(&format!(
    "SELECT id, operation_type, title, status, summary, started_at, finished_at
     FROM operation_runs
     WHERE operation_type IN ({placeholders})
     ORDER BY started_at DESC, id DESC
     LIMIT ?"
  ))?;
  let mut values: Vec<&dyn rusqlite::ToSql> = types.iter().map(|t| t as &dyn rusqlite::ToSql).collect();
  values.push(&limit);
  let items = stmt.query_map(values.as_slice(), row_to_item)?.collect::<Result<Vec<_>, _>>()?;
  Ok(items)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportLog {
  pub level: String,
  pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportDetail {
  pub run: ActivityItem,
  pub username: Option<String>,
  pub logs: Vec<ReportLog>,
}

pub fn detail(conn: &Connection, types: &[&str], run_id: i64) -> AppResult<ReportDetail> {
  let placeholders = vec!["?"; types.len()].join(", ");
  let mut values: Vec<&dyn rusqlite::ToSql> = vec![&run_id];
  values.extend(types.iter().map(|t| t as &dyn rusqlite::ToSql));
  let found = conn
    .query_row(
      &format!(
        "SELECT r.id, r.operation_type, r.title, r.status, r.summary, r.started_at, r.finished_at, u.username
         FROM operation_runs r LEFT JOIN users u ON u.id = r.user_id
         WHERE r.id = ? AND r.operation_type IN ({placeholders})"
      ),
      values.as_slice(),
      |row| Ok((row_to_item(row)?, row.get::<_, Option<String>>(7)?)),
    )
    .optional()?;
  let (run, username) = found.ok_or_else(|| AppError::validation("That report no longer exists."))?;

  let mut stmt = conn.prepare("SELECT level, message FROM operation_logs WHERE run_id = ?1 ORDER BY id")?;
  let logs = stmt
    .query_map([run_id], |row| Ok(ReportLog { level: row.get(0)?, message: row.get(1)? }))?
    .collect::<Result<Vec<_>, _>>()?;
  Ok(ReportDetail { run, username, logs })
}

// ---------------------------------------------------------------------------
// Export

/// `YYYY-MM-DD HH:MM` for a Unix time shifted by `offset_minutes` (east of UTC).
pub fn format_time(unix_seconds: i64, offset_minutes: i32) -> String {
  let local = unix_seconds + offset_minutes as i64 * 60;
  let days = local.div_euclid(86_400);
  let secs = local.rem_euclid(86_400);
  // Civil-from-days (Howard Hinnant).
  let z = days + 719_468;
  let era = z.div_euclid(146_097);
  let doe = z - era * 146_097;
  let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let day = doy - (153 * mp + 2) / 5 + 1;
  let month = if mp < 10 { mp + 3 } else { mp - 9 };
  let year = yoe + era * 400 + i64::from(month <= 2);
  format!("{year:04}-{month:02}-{day:02} {:02}:{:02}", secs / 3600, secs % 3600 / 60)
}

fn utc_label(offset_minutes: i32) -> String {
  let sign = if offset_minutes < 0 { '-' } else { '+' };
  let abs = offset_minutes.unsigned_abs();
  format!("UTC{sign}{:02}:{:02}", abs / 60, abs % 60)
}

pub fn render_text(detail: &ReportDetail, kind_label: &str, computer_name: Option<&str>, offset_minutes: i32) -> String {
  let run = &detail.run;
  let status = match run.status.as_str() {
    "success" => "Completed",
    "failed" => "Failed",
    "cancelled" => "Cancelled",
    other => other,
  };
  let kind = run.operation_type.replace('_', " ");
  let mut out = String::new();
  let heading = format!("VocaTechX {kind_label} Report");
  out.push_str(&heading);
  out.push('\n');
  out.push_str(&"=".repeat(heading.len()));
  out.push_str("\n\n");
  out.push_str(&format!("Report:      {}\n", run.title));
  out.push_str(&format!("Type:        {}\n", kind));
  out.push_str(&format!("Outcome:     {status}\n"));
  if let Some(summary) = &run.summary {
    out.push_str(&format!("Summary:     {summary}\n"));
  }
  out.push_str(&format!("Started:     {} ({})\n", format_time(run.started_at, offset_minutes), utc_label(offset_minutes)));
  if let Some(finished) = run.finished_at {
    out.push_str(&format!("Finished:    {}\n", format_time(finished, offset_minutes)));
  }
  if let Some(name) = computer_name {
    out.push_str(&format!("Computer:    {name}\n"));
  }
  if let Some(user) = &detail.username {
    out.push_str(&format!("Technician:  {user}\n"));
  }
  out.push_str("\nDetails\n-------\n");
  if detail.logs.is_empty() {
    out.push_str("No details were recorded.\n");
  }
  for log in &detail.logs {
    let tag = match log.level.as_str() {
      "warning" => "WARNING",
      "error" => "PROBLEM",
      _ => "INFO",
    };
    let mut lines = log.message.lines();
    out.push_str(&format!("[{tag}] {}\n", lines.next().unwrap_or_default()));
    for line in lines {
      out.push_str(&format!("        {line}\n"));
    }
  }
  out.push_str(&format!("\nGenerated by VocaTechX {kind_label}.\n"));
  out.replace('\n', "\r\n")
}

/// A minimal single-font PDF (Courier, A4) of the given text, with wrapping
/// and page breaks. Characters outside Windows-1252 print as `?`.
pub fn render_pdf(text: &str) -> Vec<u8> {
  const WIDTH: f32 = 595.0;
  const HEIGHT: f32 = 842.0;
  const MARGIN: f32 = 50.0;
  const FONT_SIZE: f32 = 9.0;
  const LEADING: f32 = 12.0;
  // Courier glyphs are 0.6 em wide.
  let columns = ((WIDTH - 2.0 * MARGIN) / (FONT_SIZE * 0.6)) as usize;
  let rows_per_page = ((HEIGHT - 2.0 * MARGIN) / LEADING) as usize;

  let mut lines: Vec<String> = Vec::new();
  for raw in text.lines() {
    let indent: String = raw.chars().take_while(|c| *c == ' ').collect();
    let mut current = String::new();
    for word in raw.split(' ') {
      let candidate_len = current.chars().count() + word.chars().count() + usize::from(!current.is_empty());
      if candidate_len > columns && !current.trim().is_empty() {
        lines.push(std::mem::take(&mut current));
        current.push_str(&indent);
        current.push_str("    ");
      } else if !current.is_empty() {
        current.push(' ');
      }
      // Hard-split words longer than a line.
      let mut word = word.to_string();
      while current.chars().count() + word.chars().count() > columns {
        let room = columns.saturating_sub(current.chars().count()).max(1);
        let head: String = word.chars().take(room).collect();
        word = word.chars().skip(room).collect();
        current.push_str(&head);
        lines.push(std::mem::take(&mut current));
      }
      current.push_str(&word);
    }
    lines.push(current);
  }
  let pages: Vec<&[String]> = if lines.is_empty() { vec![&[][..]] } else { lines.chunks(rows_per_page.max(1)).collect() };

  let mut objects: Vec<Vec<u8>> = Vec::new();
  // 1: catalog, 2: page tree, 3: font, then a page and content object per page.
  let page_ids: Vec<usize> = (0..pages.len()).map(|i| 4 + i * 2).collect();
  objects.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
  objects.push(
    format!(
      "<< /Type /Pages /Kids [{}] /Count {} >>",
      page_ids.iter().map(|id| format!("{id} 0 R")).collect::<Vec<_>>().join(" "),
      pages.len()
    )
    .into_bytes(),
  );
  objects.push(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>".to_vec());

  for (index, page) in pages.iter().enumerate() {
    let mut content = format!("BT /F1 {FONT_SIZE} Tf {LEADING} TL {MARGIN} {} Td\n", HEIGHT - MARGIN).into_bytes();
    for line in page.iter() {
      content.push(b'(');
      content.extend(pdf_escape(line));
      content.extend_from_slice(b") Tj T*\n");
    }
    let footer = format!("Page {} of {}", index + 1, pages.len());
    content.extend_from_slice(format!("ET BT /F1 8 Tf {MARGIN} 30 Td (").as_bytes());
    content.extend(pdf_escape(&footer));
    content.extend_from_slice(b") Tj ET");

    let content_id = page_ids[index] + 1;
    objects.push(
      format!(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {WIDTH} {HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>"
      )
      .into_bytes(),
    );
    let mut stream = format!("<< /Length {} >>\nstream\n", content.len()).into_bytes();
    stream.extend(content);
    stream.extend_from_slice(b"\nendstream");
    objects.push(stream);
  }

  let mut pdf = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n".to_vec();
  let mut offsets = Vec::with_capacity(objects.len());
  for (i, body) in objects.iter().enumerate() {
    offsets.push(pdf.len());
    pdf.extend(format!("{} 0 obj\n", i + 1).into_bytes());
    pdf.extend(body);
    pdf.extend_from_slice(b"\nendobj\n");
  }
  let xref = pdf.len();
  pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).into_bytes());
  for offset in offsets {
    pdf.extend(format!("{offset:010} 00000 n \n").into_bytes());
  }
  pdf.extend(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).into_bytes());
  pdf
}

/// Encodes a line as a PDF literal string body in Windows-1252.
fn pdf_escape(line: &str) -> Vec<u8> {
  let mut out = Vec::with_capacity(line.len());
  for c in line.chars() {
    let byte = match c {
      '(' | ')' | '\\' => {
        out.push(b'\\');
        c as u8
      }
      ' '..='~' => c as u8,
      '\t' => b' ',
      '\u{2013}' => 0x96,
      '\u{2014}' => 0x97,
      '\u{2018}' => 0x91,
      '\u{2019}' => 0x92,
      '\u{201C}' => 0x93,
      '\u{201D}' => 0x94,
      '\u{2022}' => 0x95,
      '\u{2026}' => 0x85,
      '\u{20AC}' => 0x80,
      c if ('\u{A0}'..='\u{FF}').contains(&c) => c as u32 as u8,
      _ => b'?',
    };
    out.push(byte);
  }
  out
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
  fn records_runs_with_logs_and_lists_only_network_history() {
    let conn = memory_db();
    let logs = [LogLine::new(Level::Info, "[PASS] Adapter"), LogLine::new(Level::Error, "[FAIL] DNS")];
    let id = record(
      &conn,
      NewRun {
        user_id: 1,
        operation_type: "network_diagnostics",
        title: "Connectivity diagnostics",
        status: "failed",
        summary: "DNS failed",
        started_at: 100,
        finished_at: 105,
        logs: &logs,
      },
    )
    .unwrap();
    conn
      .execute("INSERT INTO operation_runs (operation_type, title, status) VALUES ('windows_repair', 'Other', 'success')", [])
      .unwrap();

    let history = history(&conn, OPERATION_TYPES, 10).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].id, id);

    let detail = detail(&conn, OPERATION_TYPES, id).unwrap();
    assert_eq!(detail.username.as_deref(), Some("administrator"));
    assert_eq!(detail.logs.len(), 2);
    assert_eq!(detail.logs[1].level, "error");

    let other_id: i64 = conn.query_row("SELECT id FROM operation_runs WHERE title = 'Other'", [], |r| r.get(0)).unwrap();
    assert!(super::detail(&conn, OPERATION_TYPES, other_id).is_err());
  }

  #[test]
  fn formats_times_with_offset() {
    assert_eq!(format_time(0, 0), "1970-01-01 00:00");
    assert_eq!(format_time(1_760_600_000, 480), "2025-10-16 15:33");
    assert_eq!(format_time(1_709_164_800, 0), "2024-02-29 00:00");
    assert_eq!(utc_label(480), "UTC+08:00");
    assert_eq!(utc_label(-330), "UTC-05:30");
  }

  #[test]
  fn text_report_contains_details() {
    let detail = ReportDetail {
      run: ActivityItem {
        id: 1,
        operation_type: "network_repair".into(),
        title: "Flush DNS cache".into(),
        status: "success".into(),
        summary: Some("Cleared".into()),
        started_at: 0,
        finished_at: Some(60),
      },
      username: Some("tech".into()),
      logs: vec![ReportLog { level: "error".into(), message: "line one\nline two".into() }],
    };
    let text = render_text(&detail, "Network Center", Some("LAB-PC"), 0);
    assert!(text.contains("VocaTechX Network Center Report"));
    assert!(text.contains("Outcome:     Completed"));
    assert!(text.contains("[PROBLEM] line one\r\n        line two"));
    assert!(text.contains("Computer:    LAB-PC"));
  }

  #[test]
  fn pdf_is_well_formed_and_paginates() {
    let long: String = (0..150).map(|i| format!("Line {i} (with parens) and a backslash \\ and café\n")).collect();
    let pdf = render_pdf(&long);
    let text = String::from_utf8_lossy(&pdf);
    assert!(text.starts_with("%PDF-1.4"));
    assert!(text.trim_end().ends_with("%%EOF"));
    assert!(text.contains("/Count 3"));
    assert!(text.contains(r"\(with parens\)"));

    // Every xref offset points at its object header.
    let xref_at: usize = text.rsplit("startxref\n").next().unwrap().lines().next().unwrap().parse().unwrap();
    let xref = &pdf[xref_at..];
    let xref_text = String::from_utf8_lossy(xref);
    for (i, line) in xref_text.lines().skip(3).take_while(|l| l.ends_with(" n ")).enumerate() {
      let offset: usize = line[..10].parse().unwrap();
      assert!(pdf[offset..].starts_with(format!("{} 0 obj", i + 1).as_bytes()));
    }
  }

  #[test]
  fn pdf_wraps_long_lines() {
    let pdf = render_pdf(&"word ".repeat(100));
    let text = String::from_utf8_lossy(&pdf);
    assert!(text.matches(") Tj T*").count() >= 5);
  }
}
