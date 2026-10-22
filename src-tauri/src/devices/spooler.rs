//! The Print Spooler service: reading its real state, and (in later phases)
//! starting, restarting and resetting the print queue. Reads use `Win32_Service`
//! so the running state, start mode, process id and last exit code are all
//! available in one query.

use serde::{Deserialize, Serialize};

use super::query_one;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawService {
  #[serde(default)]
  exists: bool,
  #[serde(default)]
  display_name: Option<String>,
  #[serde(default)]
  state: Option<String>,
  #[serde(default)]
  start_mode: Option<String>,
  #[serde(default)]
  start_name: Option<String>,
  #[serde(default)]
  process_id: i64,
  #[serde(default)]
  exit_code: i64,
  #[serde(default)]
  accept_stop: bool,
}

/// The Print Spooler service state, as presented to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpoolerStatus {
  /// False only if the Spooler service is missing from this Windows install.
  pub exists: bool,
  pub display_name: String,
  /// Raw service state: `Running`, `Stopped`, `Start Pending`, etc.
  pub state: String,
  /// True when the service is running normally.
  pub running: bool,
  /// `ok`, `warn` or `error` for the status indicator.
  pub health: &'static str,
  /// `Automatic`, `Manual` or `Disabled`.
  pub start_mode: String,
  /// The account the service runs as, e.g. `LocalSystem`.
  pub start_name: Option<String>,
  pub process_id: Option<u32>,
  /// The service's last exit code; non-zero after a failed start is a clue.
  pub exit_code: i64,
  /// Whether the service reports it can be stopped right now.
  pub can_stop: bool,
  /// A short plain-language summary of the state.
  pub summary: String,
}

const SPOOLER_SCRIPT: &str = r#"
$s = Get-CimInstance -ClassName Win32_Service -Filter "Name='Spooler'" -ErrorAction SilentlyContinue
if ($null -eq $s) {
  [pscustomobject]@{ exists = $false } | ConvertTo-Json -Compress
} else {
  [pscustomobject]@{
    exists      = $true
    displayName = [string]$s.DisplayName
    state       = [string]$s.State
    startMode   = [string]$s.StartMode
    startName   = [string]$s.StartName
    processId   = [int]$s.ProcessId
    exitCode    = [int]$s.ExitCode
    acceptStop  = [bool]$s.AcceptStop
  } | ConvertTo-Json -Compress
}
"#;

fn normalize_start_mode(raw: Option<String>) -> String {
  match raw.as_deref().map(str::trim) {
    Some("Auto") => "Automatic".to_string(),
    Some(other) if !other.is_empty() => other.to_string(),
    _ => "Unknown".to_string(),
  }
}

/// Reads the current Print Spooler service state. Needs no administrator rights.
pub fn status() -> Result<SpoolerStatus, String> {
  let raw: RawService = query_one("Could not read the Print Spooler service", SPOOLER_SCRIPT)?;
  if !raw.exists {
    return Ok(SpoolerStatus {
      exists: false,
      display_name: "Print Spooler".to_string(),
      state: "Not installed".to_string(),
      running: false,
      health: "error",
      start_mode: "Unknown".to_string(),
      start_name: None,
      process_id: None,
      exit_code: 0,
      can_stop: false,
      summary: "The Print Spooler service is not present on this computer. Printing is unavailable until it is restored.".to_string(),
    });
  }

  let state = raw.state.unwrap_or_default();
  let state = if state.trim().is_empty() { "Unknown".to_string() } else { state };
  let running = state.eq_ignore_ascii_case("Running");
  let start_mode = normalize_start_mode(raw.start_mode);
  let disabled = start_mode.eq_ignore_ascii_case("Disabled");

  let (health, summary) = if running {
    ("ok", "The Print Spooler service is running.".to_string())
  } else if disabled {
    (
      "error",
      "The Print Spooler service is disabled, so printing cannot work. It must be set to start automatically.".to_string(),
    )
  } else if raw.exit_code != 0 {
    (
      "error",
      format!("The Print Spooler service is {} and last exited with code {}.", state.to_lowercase(), raw.exit_code),
    )
  } else {
    ("warn", format!("The Print Spooler service is {}.", state.to_lowercase()))
  };

  Ok(SpoolerStatus {
    exists: true,
    display_name: raw.display_name.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "Print Spooler".to_string()),
    running,
    health,
    state,
    start_mode,
    start_name: raw.start_name.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
    process_id: (raw.process_id > 0).then_some(raw.process_id as u32),
    exit_code: raw.exit_code,
    can_stop: raw.accept_stop,
    summary,
  })
}

/// The exact Windows service name, for callers that control it (later phases).
#[allow(dead_code)]
pub const SERVICE_NAME: &str = "Spooler";

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn raw_service_reads_script_json() {
    let line = r#"{"exists":true,"displayName":"Print Spooler","state":"Running","startMode":"Auto","startName":"LocalSystem","processId":4321,"exitCode":0,"acceptStop":true}"#;
    let raw: RawService = serde_json::from_str(line).unwrap();
    assert!(raw.exists && raw.accept_stop);
    assert_eq!(raw.display_name.as_deref(), Some("Print Spooler"));
    assert_eq!(raw.process_id, 4321);
    assert_eq!(normalize_start_mode(raw.start_mode), "Automatic");
  }

  #[test]
  fn script_has_no_duplicate_keys() {
    let mut keys: Vec<&str> =
      SPOOLER_SCRIPT.lines().filter_map(|l| l.split_once(" = ").map(|(k, _)| k.trim())).collect();
    let total = keys.len();
    keys.sort_unstable();
    keys.dedup();
    assert_eq!(keys.len(), total, "PowerShell rejects duplicate keys in a hash literal");
  }
}
