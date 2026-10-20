//! Printer discovery and the safe "open the native Windows window" actions.
//!
//! Printers are read from `Win32_Printer` (one reliable query that reports the
//! default printer, offline state, status codes, port and driver) joined with
//! `Get-PrinterDriver` for the manufacturer. State-changing actions
//! (set default, test page) live in `jobs`/`diagnostics`; here we only read and
//! open the built-in Windows dialogs.

use serde::{Deserialize, Serialize};

use super::query_lines;
use super::validate;
use crate::error::{AppError, AppResult};
use crate::network::process;

/// Raw per-printer record emitted by the PowerShell query, in the shape its
/// JSON uses.
#[derive(Debug, Clone, Deserialize)]
struct RawPrinter {
  name: String,
  #[serde(default)]
  is_default: bool,
  #[serde(default)]
  work_offline: bool,
  #[serde(default)]
  shared: bool,
  #[serde(default)]
  network: bool,
  #[serde(default)]
  port_name: Option<String>,
  #[serde(default)]
  driver_name: Option<String>,
  #[serde(default)]
  manufacturer: Option<String>,
  #[serde(default)]
  location: Option<String>,
  #[serde(default)]
  comment: Option<String>,
  #[serde(default)]
  server_name: Option<String>,
  #[serde(default)]
  status_code: i64,
  #[serde(default)]
  detected_error: i64,
}

/// A printer as presented to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
  pub name: String,
  pub is_default: bool,
  pub shared: bool,
  /// Short reported status, e.g. "Ready", "Offline", "Paper jam".
  pub status: String,
  /// One of `ok`, `warn`, `error`, `offline` for the status indicator.
  pub health: &'static str,
  pub connection: String,
  pub port_name: Option<String>,
  pub driver_name: Option<String>,
  pub manufacturer: Option<String>,
  pub location: Option<String>,
  pub comment: Option<String>,
  pub server_name: Option<String>,
}

fn clean(value: Option<String>) -> Option<String> {
  value.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Infers a human connection type from the port name and the network flag.
fn connection(port: Option<&str>, network: bool) -> String {
  let Some(port) = port.map(|p| p.trim()).filter(|p| !p.is_empty()) else {
    return if network { "Network".into() } else { "Local".into() };
  };
  let upper = port.to_ascii_uppercase();
  if upper.starts_with("USB") {
    "USB".into()
  } else if port.starts_with(r"\\") {
    "Network share".into()
  } else if upper.starts_with("WSD") {
    "Network (WSD)".into()
  } else if upper.starts_with("IP_") || upper.starts_with("TCPIP") || upper.parse::<std::net::IpAddr>().is_ok() {
    "Network (TCP/IP)".into()
  } else if upper.starts_with("COM") || upper.starts_with("LPT") {
    "Local port".into()
  } else if upper.starts_with("FILE")
    || upper.starts_with("NUL")
    || upper.starts_with("PORTPROMPT")
    || upper.contains("PDF")
    || upper.contains("XPS")
    || upper.contains("ONENOTE")
  {
    "Virtual".into()
  } else if network {
    "Network".into()
  } else {
    "Local".into()
  }
}

/// Maps the Windows status codes to a short phrase plus a health class.
fn status(work_offline: bool, status_code: i64, detected_error: i64) -> (String, &'static str) {
  // A real device fault takes priority over the generic status.
  let fault = match detected_error {
    3 => Some("Low paper"),
    4 => Some("Out of paper"),
    5 => Some("Low toner"),
    6 => Some("Out of toner"),
    7 => Some("Door open"),
    8 => Some("Paper jam"),
    10 => Some("Service requested"),
    11 => Some("Output bin full"),
    _ => None,
  };
  if let Some(fault) = fault {
    return (fault.to_string(), "error");
  }
  if work_offline || detected_error == 9 || status_code == 7 {
    return ("Offline".to_string(), "offline");
  }
  match status_code {
    3 => ("Ready".to_string(), "ok"),
    4 => ("Printing".to_string(), "ok"),
    5 => ("Warming up".to_string(), "ok"),
    6 => ("Stopped".to_string(), "warn"),
    1 | 2 => ("Unknown".to_string(), "warn"),
    _ => ("Ready".to_string(), "ok"),
  }
}

const PRINTERS_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$makers = @{}
try {
  foreach ($d in Get-PrinterDriver -ErrorAction Stop) {
    if ($d.Name -and $d.Manufacturer -and -not $makers.ContainsKey($d.Name)) {
      $makers[$d.Name] = [string]$d.Manufacturer
    }
  }
} catch {}
foreach ($p in Get-CimInstance -ClassName Win32_Printer -ErrorAction Stop) {
  $maker = $null
  if ($p.DriverName -and $makers.ContainsKey($p.DriverName)) { $maker = $makers[$p.DriverName] }
  [pscustomobject]@{
    name          = [string]$p.Name
    isDefault     = [bool]$p.Default
    workOffline   = [bool]$p.WorkOffline
    shared        = [bool]$p.Shared
    network       = [bool]$p.Network
    portName      = [string]$p.PortName
    driverName    = [string]$p.DriverName
    manufacturer  = $maker
    location      = [string]$p.Location
    comment       = [string]$p.Comment
    serverName    = [string]$p.ServerName
    statusCode    = [int]$p.PrinterStatus
    detectedError = [int]$p.DetectedErrorState
  } | ConvertTo-Json -Compress -Depth 2
}
"#;

/// Every printer Windows exposes on this computer.
pub fn list() -> Result<Vec<PrinterInfo>, String> {
  let raw: Vec<RawPrinter> = query_lines("Could not read the installed printers", PRINTERS_SCRIPT)?;
  let mut printers: Vec<PrinterInfo> = raw
    .into_iter()
    .map(|p| {
      let (status, health) = status(p.work_offline, p.status_code, p.detected_error);
      PrinterInfo {
        connection: connection(p.port_name.as_deref(), p.network),
        name: p.name,
        is_default: p.is_default,
        shared: p.shared,
        status,
        health,
        port_name: clean(p.port_name),
        driver_name: clean(p.driver_name),
        manufacturer: clean(p.manufacturer),
        location: clean(p.location),
        comment: clean(p.comment),
        server_name: clean(p.server_name),
      }
    })
    .collect();
  printers.sort_by(|a, b| b.is_default.cmp(&a.is_default).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
  Ok(printers)
}

/// Confirms a printer name is actually installed before an action targets it.
pub fn ensure_installed(name: &str) -> AppResult<String> {
  let name = validate::printer_name(name)?;
  let installed = list().map_err(AppError::Network)?;
  if installed.iter().any(|p| p.name.eq_ignore_ascii_case(&name)) {
    Ok(name)
  } else {
    Err(AppError::validation("That printer is no longer installed. Refresh the list."))
  }
}

/// A native printer window the UI can open through `printui.dll`.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrinterWindow {
  /// The print queue (jobs) window.
  Queue,
  /// The printer Properties dialog.
  Properties,
  /// The Printing Preferences dialog.
  Preferences,
}

/// Opens the Windows "Printers & scanners" settings page.
pub fn open_settings() -> AppResult<()> {
  process::launch(&process::windows_dir("explorer.exe"), &["ms-settings:printers"]).map_err(AppError::Network)
}

/// Opens a native per-printer window (queue, properties or preferences) through
/// the documented `printui.dll,PrintUIEntry` entry points. The printer name is
/// validated and confirmed installed, then passed as a separate argument.
pub fn open_window(name: &str, window: PrinterWindow) -> AppResult<()> {
  let name = ensure_installed(name)?;
  let flag = match window {
    PrinterWindow::Queue => "/o",
    PrinterWindow::Properties => "/p",
    PrinterWindow::Preferences => "/e",
  };
  process::launch(
    &process::system32("rundll32.exe"),
    &["printui.dll,PrintUIEntry", flag, "/n", &name],
  )
  .map_err(AppError::Network)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn connection_is_inferred_from_port() {
    assert_eq!(connection(Some("USB001"), false), "USB");
    assert_eq!(connection(Some(r"\\PRINTSRV\HP"), true), "Network share");
    assert_eq!(connection(Some("WSD-abc"), true), "Network (WSD)");
    assert_eq!(connection(Some("IP_192.168.1.50"), true), "Network (TCP/IP)");
    assert_eq!(connection(Some("192.168.1.50"), true), "Network (TCP/IP)");
    assert_eq!(connection(Some("LPT1:"), false), "Local port");
    assert_eq!(connection(Some("PORTPROMPT:"), false), "Virtual");
    assert_eq!(connection(None, true), "Network");
    assert_eq!(connection(None, false), "Local");
  }

  #[test]
  fn status_prioritises_faults_then_offline() {
    assert_eq!(status(false, 3, 2), ("Ready".to_string(), "ok"));
    assert_eq!(status(false, 4, 2), ("Printing".to_string(), "ok"));
    assert_eq!(status(true, 3, 2).1, "offline");
    assert_eq!(status(false, 7, 0).1, "offline");
    assert_eq!(status(false, 3, 8), ("Paper jam".to_string(), "error"));
    assert_eq!(status(false, 3, 4), ("Out of paper".to_string(), "error"));
  }
}
