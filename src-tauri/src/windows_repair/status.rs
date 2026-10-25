//! The status cards on the Windows Repair page: what Windows reports right now
//! (version, pending restart, Safe Mode, free space, disk health, restore
//! points, memory test) plus the last result of each repair from the history.
//! Anything Windows does not answer is left empty, never guessed.

use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::{RepairId, OPERATION_TYPE};
use crate::network::process;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowsStatus {
  pub product_name: Option<String>,
  pub display_version: Option<String>,
  pub build: Option<u32>,
  pub ubr: Option<u32>,
  /// Windows Update or servicing is waiting for a restart.
  pub reboot_pending: Option<bool>,
  /// Started in Safe Mode right now.
  pub in_safe_mode: Option<bool>,
  /// The free space on the Windows drive.
  pub free_bytes: Option<u64>,
  pub total_bytes: Option<u64>,
  /// `Healthy`, `Warning` or `Unhealthy`, as Storage reports it.
  pub disk_health: Option<String>,
  pub disk_media: Option<String>,
  /// Unix time of the newest restore point, if any can be read.
  pub last_restore_point: Option<i64>,
  pub restore_point_count: Option<u32>,
  /// Unix time and result of the last Windows Memory Diagnostic.
  pub memory_test_at: Option<i64>,
  pub memory_test_passed: Option<bool>,
}

/// The newest history entry of one repair.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastRun {
  pub id: i64,
  pub status: String,
  pub summary: Option<String>,
  pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairStatus {
  pub drive: String,
  pub elevated: bool,
  pub running: bool,
  /// `bcdedit` reports `safeboot` on the current entry: the next start is Safe Mode.
  pub safe_mode_set: Option<bool>,
  pub windows: WindowsStatus,
  pub last_sfc: Option<LastRun>,
  pub last_dism: Option<LastRun>,
  pub last_chkdsk: Option<LastRun>,
}

/// A fixed script: it takes no input. Every value is read in its own `try`,
/// so one blocked query leaves only that field empty.
const SCRIPT: &str = r#"$r = [ordered]@{}
try {
  $cv = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
  $r.productName = [string]$cv.ProductName
  $r.displayVersion = [string]$cv.DisplayVersion
  $r.build = [int]$cv.CurrentBuildNumber
  $r.ubr = [int]$cv.UBR
} catch {}
try {
  $r.rebootPending = (Test-Path -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') -or
    (Test-Path -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')
} catch {}
try { $r.inSafeMode = ([string](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).BootupState) -ne 'Normal boot' } catch {}
try {
  $letter = $env:SystemDrive.Substring(0, 1)
  $v = Get-Volume -DriveLetter $letter -ErrorAction Stop
  $r.freeBytes = [uint64]$v.SizeRemaining
  $r.totalBytes = [uint64]$v.Size
  $disk = Get-Partition -DriveLetter $letter -ErrorAction Stop | Get-Disk -ErrorAction Stop
  $pd = Get-PhysicalDisk -ErrorAction Stop | Where-Object { [string]$_.DeviceId -eq [string]$disk.Number } | Select-Object -First 1
  if ($pd) { $r.diskHealth = [string]$pd.HealthStatus; $r.diskMedia = [string]$pd.MediaType } else { $r.diskHealth = [string]$disk.HealthStatus }
} catch {}
try {
  $points = @(Get-ComputerRestorePoint -ErrorAction Stop)
  $r.restorePointCount = $points.Count
  if ($points.Count -gt 0) {
    $newest = $points | Sort-Object SequenceNumber | Select-Object -Last 1
    $r.lastRestorePoint = [DateTimeOffset]::new([Management.ManagementDateTimeConverter]::ToDateTime($newest.CreationTime)).ToUnixTimeSeconds()
  }
} catch {}
try {
  $e = Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-MemoryDiagnostics-Results' } -MaxEvents 1 -ErrorAction Stop
  $r.memoryTestAt = [DateTimeOffset]::new($e.TimeCreated).ToUnixTimeSeconds()
  $r.memoryTestPassed = $e.Id -eq 1201
} catch {}
$r | ConvertTo-Json -Compress"#;

pub fn query_windows() -> WindowsStatus {
  let Ok(out) = process::powershell(SCRIPT, Duration::from_secs(60)) else { return WindowsStatus::default() };
  let json = out.stdout.lines().rev().find(|l| l.trim_start().starts_with('{')).unwrap_or("{}");
  serde_json::from_str(json).unwrap_or_default()
}

/// Reads `bcdedit /enum {current}`. Needs administrator rights; `None` without them.
pub fn safe_mode_set() -> Option<bool> {
  let out = process::run(&process::system32("bcdedit.exe"), &["/enum", "{current}"], Duration::from_secs(20)).ok()?;
  if !out.success() {
    return None;
  }
  Some(has_safeboot(&out.stdout))
}

/// `safeboot` is a fixed element name that bcdedit does not translate.
pub fn has_safeboot(enum_output: &str) -> bool {
  enum_output.lines().any(|l| l.trim_start().to_ascii_lowercase().starts_with("safeboot "))
}

/// The newest history entry recorded for `repair`, on its own or as part of a full repair.
pub fn last_run(conn: &Connection, repair: RepairId) -> Option<LastRun> {
  conn
    .query_row(
      "SELECT id, status, summary, finished_at FROM operation_runs
       WHERE operation_type = ?1 AND title = ?2
       ORDER BY started_at DESC, id DESC LIMIT 1",
      params![OPERATION_TYPE, repair.title()],
      |row| Ok(LastRun { id: row.get(0)?, status: row.get(1)?, summary: row.get(2)?, finished_at: row.get(3)? }),
    )
    .optional()
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_safeboot_from_bcdedit() {
    let set = "Windows Boot Loader\n-------------------\nidentifier              {current}\nsafeboot                Minimal\n";
    let unset = "Windows Boot Loader\n-------------------\nidentifier              {current}\nnx                      OptIn\n";
    assert!(has_safeboot(set));
    assert!(!has_safeboot(unset));
  }

  #[test]
  fn partial_status_json_leaves_the_rest_empty() {
    let s: WindowsStatus = serde_json::from_str(r#"{"productName":"Windows 10 Pro","build":22631,"freeBytes":1024}"#).unwrap();
    assert_eq!(s.build, Some(22631));
    assert_eq!(s.free_bytes, Some(1024));
    assert!(s.disk_health.is_none() && s.reboot_pending.is_none());
  }

  #[cfg(windows)]
  #[test]
  fn queries_this_computer() {
    let s = query_windows();
    assert!(s.build.is_some_and(|b| b >= 10_000), "{s:?}");
    assert!(s.total_bytes.is_some_and(|t| t > 0), "{s:?}");
  }
}
