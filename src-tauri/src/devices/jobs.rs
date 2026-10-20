//! The print queue: listing the jobs the spooler currently holds, and (in later
//! phases) cancelling, pausing, resuming and clearing them. Jobs are read with
//! `Get-PrintJob` across every installed printer.

use serde::{Deserialize, Serialize};

use super::query_lines;

#[derive(Debug, Clone, Deserialize)]
struct RawJob {
  #[serde(default)]
  id: i64,
  #[serde(default)]
  printer_name: Option<String>,
  #[serde(default)]
  document_name: Option<String>,
  #[serde(default)]
  owner: Option<String>,
  #[serde(default)]
  status: Option<String>,
  #[serde(default)]
  pages: i64,
  #[serde(default)]
  size_bytes: i64,
  #[serde(default)]
  submitted_at: Option<i64>,
}

/// A single print job as presented to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintJob {
  pub id: u32,
  pub printer_name: String,
  pub document_name: String,
  pub owner: Option<String>,
  /// The raw spooler status, e.g. "Normal", "Printing", "Paused, Error".
  pub status: String,
  pub pages: Option<u32>,
  pub size_bytes: Option<u64>,
  /// Unix seconds the job was submitted, when Windows reports it.
  pub submitted_at: Option<i64>,
  /// `ok`, `warn` or `error` for the status indicator.
  pub health: &'static str,
  /// True when the job is paused, errored or otherwise needs attention and is a
  /// candidate for cancelling.
  pub needs_attention: bool,
}

const JOBS_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
foreach ($pr in (Get-Printer -ErrorAction SilentlyContinue)) {
  foreach ($j in (Get-PrintJob -PrinterName $pr.Name -ErrorAction SilentlyContinue)) {
    $sub = $null
    if ($j.SubmittedTime) { try { $sub = [int64]([DateTimeOffset]$j.SubmittedTime).ToUnixTimeSeconds() } catch {} }
    [pscustomobject]@{
      id           = [int]$j.Id
      printerName  = [string]$j.PrinterName
      documentName = [string]$j.DocumentName
      owner        = [string]$j.UserName
      status       = [string]$j.JobStatus
      pages        = [int]$j.TotalPages
      sizeBytes    = [int64]$j.Size
      submittedAt  = $sub
    } | ConvertTo-Json -Compress
  }
}
"#;

/// Classifies a spooler job status string into a health class and whether it
/// needs attention.
fn classify(status: &str) -> (&'static str, bool) {
  let s = status.to_ascii_lowercase();
  let error = ["error", "blocked", "offline", "paperout", "paper out", "userintervention", "user intervention"]
    .iter()
    .any(|k| s.contains(k));
  let attention = ["paused", "deleting", "deleted", "restart"].iter().any(|k| s.contains(k));
  if error {
    ("error", true)
  } else if attention {
    ("warn", true)
  } else {
    ("ok", false)
  }
}

/// Every print job currently in any printer's queue.
pub fn list() -> Result<Vec<PrintJob>, String> {
  let raw: Vec<RawJob> = query_lines("Could not read the print queue", JOBS_SCRIPT)?;
  let mut jobs: Vec<PrintJob> = raw
    .into_iter()
    .map(|j| {
      let status = j.status.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "Unknown".to_string());
      let (health, needs_attention) = classify(&status);
      PrintJob {
        id: j.id.clamp(0, u32::MAX as i64) as u32,
        printer_name: j.printer_name.unwrap_or_default(),
        document_name: j.document_name.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()).unwrap_or_else(|| "(untitled document)".to_string()),
        owner: j.owner.map(|o| o.trim().to_string()).filter(|o| !o.is_empty()),
        status,
        pages: (j.pages > 0).then_some(j.pages as u32),
        size_bytes: (j.size_bytes > 0).then_some(j.size_bytes as u64),
        submitted_at: j.submitted_at,
        health,
        needs_attention,
      }
    })
    .collect();
  // Attention-needing jobs first, then by submit time.
  jobs.sort_by(|a, b| b.needs_attention.cmp(&a.needs_attention).then_with(|| a.submitted_at.cmp(&b.submitted_at)));
  Ok(jobs)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn classifies_job_status() {
    assert_eq!(classify("Normal"), ("ok", false));
    assert_eq!(classify("Printing"), ("ok", false));
    assert_eq!(classify("Paused"), ("warn", true));
    assert_eq!(classify("Error, Printing"), ("error", true));
    assert_eq!(classify("Offline"), ("error", true));
  }
}
