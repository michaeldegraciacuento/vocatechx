//! Printer & Devices: printer discovery and repair (Print Spooler, stuck jobs,
//! queue reset, connection and driver troubleshooting) and Plug-and-Play device
//! inspection (hardware overview, unknown devices, USB, drivers).
//!
//! Everything reads real Windows state through documented interfaces
//! (`Win32_Printer`, `Get-PrinterDriver`, `Get-PrintJob`, `Win32_Service`,
//! `Get-PnpDevice`, `Win32_PnPSignedDriver`). Read queries go through
//! `powershell`; state changes go through `powershell_elevated` (UAC) and are
//! always re-verified against real state rather than trusting an exit code.

pub mod hardware;
pub mod jobs;
pub mod printers;
pub mod spooler;
pub mod validate;

use std::time::Duration;

use serde::de::DeserializeOwned;

use crate::network::process::{self, CommandOutput};

/// How long a read query may run before it is abandoned.
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// A PowerShell read query failed, described for the user.
pub fn query_error(context: &str, output: &CommandOutput) -> String {
  let detail = output.text();
  let detail = detail.lines().next().unwrap_or("").trim();
  if detail.is_empty() {
    format!("{context} (Windows reported no details).")
  } else {
    format!("{context}: {detail}")
  }
}

/// Runs a read-only PowerShell query that prints one compact JSON object per
/// line (newline-delimited JSON), and parses each line into `T`. A line that
/// cannot be parsed is logged and skipped, so one malformed record never hides
/// the rest. The query itself must not require administrator rights.
pub fn query_lines<T: DeserializeOwned>(context: &str, script: &str) -> Result<Vec<T>, String> {
  let output = process::powershell(script, READ_TIMEOUT).map_err(|e| format!("{context}: {e}"))?;
  // These queries end by emitting data, so a non-zero exit with no stdout is a
  // real failure; a non-zero exit that still produced rows (one printer failed
  // to enumerate, say) is tolerated and the rows are kept.
  if !output.success() && output.stdout.trim().is_empty() {
    return Err(query_error(context, &output));
  }
  let mut items = Vec::new();
  for line in output.stdout.lines().map(str::trim).filter(|l| !l.is_empty()) {
    match serde_json::from_str::<T>(line) {
      Ok(item) => items.push(item),
      Err(e) => log::warn!("{context}: skipped an unreadable record: {e}"),
    }
  }
  Ok(items)
}

/// Runs a read-only PowerShell query that prints exactly one compact JSON
/// object, and parses it into `T`.
pub fn query_one<T: DeserializeOwned>(context: &str, script: &str) -> Result<T, String> {
  let output = process::powershell(script, READ_TIMEOUT).map_err(|e| format!("{context}: {e}"))?;
  let line = output.stdout.lines().map(str::trim).find(|l| !l.is_empty());
  match line {
    Some(line) => serde_json::from_str::<T>(line).map_err(|e| format!("{context}: could not read the result ({e}).")),
    None => Err(query_error(context, &output)),
  }
}

#[cfg(test)]
mod tests {
  /// Runs every read query against this machine's real Windows state.
  /// `cargo test devices_live -- --ignored --nocapture`
  #[test]
  #[ignore]
  fn devices_live() {
    let spooler = super::spooler::status().unwrap();
    println!("spooler: {} ({})", spooler.state, spooler.start_mode);
    assert!(spooler.exists);

    let printers = super::printers::list().unwrap();
    println!("printers: {}", printers.len());
    assert!(printers.iter().all(|p| !p.name.is_empty()));

    let jobs = super::jobs::list().unwrap();
    println!("jobs: {}", jobs.len());
    assert!(jobs.iter().all(|j| !j.printer_name.is_empty()));

    let devices = super::hardware::list().unwrap();
    println!("devices: {} ({} with problems)", devices.len(), devices.iter().filter(|d| d.problem_code != 0).count());
    assert!(!devices.is_empty());

    let drivers = super::hardware::drivers().unwrap();
    println!("drivers: {}", drivers.len());
    assert!(!drivers.is_empty());
  }
}
