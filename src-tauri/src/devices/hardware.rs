//! Plug-and-Play hardware: the device overview, problem/unknown devices, and
//! installed device drivers. Devices come from `Get-PnpDevice` (the documented
//! PnP cmdlet, which reports status and the Windows problem code) and driver
//! details from `Win32_PnPSignedDriver`.

use serde::{Deserialize, Serialize};

use super::query_lines;
use super::validate;
use crate::error::{AppError, AppResult};
use crate::network::process;

#[derive(Debug, Clone, Deserialize)]
struct RawDevice {
  #[serde(default)]
  instance_id: Option<String>,
  #[serde(default)]
  name: Option<String>,
  #[serde(default)]
  class: Option<String>,
  #[serde(default)]
  status: Option<String>,
  #[serde(default)]
  problem_code: i64,
  #[serde(default)]
  manufacturer: Option<String>,
  #[serde(default)]
  service: Option<String>,
  #[serde(default)]
  present: bool,
}

/// A hardware device as presented to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
  pub instance_id: String,
  pub name: String,
  /// Friendly category label, e.g. "USB", "Audio", "Display adapters".
  pub category: &'static str,
  /// The raw Windows device class, e.g. "USB", "Net", "Media".
  pub class: Option<String>,
  pub manufacturer: Option<String>,
  pub service: Option<String>,
  /// Raw device status: `OK`, `Error`, `Degraded`, `Unknown`.
  pub status: String,
  pub problem_code: i64,
  /// Explanation of the problem code, when there is one.
  pub problem_text: Option<String>,
  /// `ok`, `warn` or `error` for the status indicator.
  pub health: &'static str,
  pub present: bool,
}

/// Maps a Windows device class to a friendly category for grouping and filters.
fn category(class: Option<&str>) -> &'static str {
  match class.unwrap_or("").to_ascii_uppercase().as_str() {
    "USB" | "USBDEVICE" | "USBFNCLASS" => "USB",
    "MEDIA" | "AUDIOENDPOINT" | "AUDIOPROCESSINGOBJECT" | "SOUND" => "Audio",
    "CAMERA" | "IMAGE" | "WPD" => "Cameras & imaging",
    "KEYBOARD" => "Keyboards",
    "MOUSE" | "HIDCLASS" | "HID" => "Mice & input",
    "BLUETOOTH" => "Bluetooth",
    "DISKDRIVE" | "VOLUME" | "CDROM" | "FLOPPYDISK" | "SCSIADAPTER" | "HDC" => "Storage",
    "NET" | "NETCLIENT" | "NETSERVICE" | "NETTRANS" => "Network adapters",
    "DISPLAY" => "Display adapters",
    "MONITOR" => "Monitors",
    "PRINTER" | "PRINTQUEUE" => "Printers",
    "PROCESSOR" => "Processors",
    "SYSTEM" => "System devices",
    "" => "Other devices",
    _ => "Other devices",
  }
}

/// Explains a Windows Device Manager problem (Configuration Manager) code.
/// Only the codes a technician commonly meets are spelled out; the rest report
/// the number so it can be looked up.
fn problem_text(code: i64) -> Option<String> {
  let text = match code {
    0 => return None,
    1 => "Device is not configured correctly (code 1).",
    3 => "The driver may be corrupted, or memory is low (code 3).",
    10 => "Device cannot start (code 10).",
    12 => "Not enough free resources for this device (code 12).",
    14 => "Device needs a restart to work (code 14).",
    18 => "Reinstall the drivers for this device (code 18).",
    19 => "Windows cannot start this device; the registry configuration is damaged (code 19).",
    21 => "Windows is removing this device (code 21).",
    22 => "This device is disabled (code 22).",
    24 => "Device is not present, not working, or missing a driver (code 24).",
    28 => "The drivers for this device are not installed (code 28).",
    31 => "This device is not working because Windows cannot load its drivers (code 31).",
    37 => "Windows cannot initialize the device driver (code 37).",
    39 => "Windows cannot load the device driver; it may be corrupted or missing (code 39).",
    43 => "Windows stopped this device because it reported problems (code 43).",
    45 => "This device is not connected (code 45).",
    _ => return Some(format!("Device Manager reports problem code {code}.")),
  };
  Some(text.to_string())
}

const DEVICES_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
foreach ($d in Get-PnpDevice -ErrorAction Stop) {
  $code = 0
  try { if ($null -ne $d.ProblemCode) { $code = [int]$d.ProblemCode } } catch {}
  [pscustomobject]@{
    instanceId   = [string]$d.InstanceId
    name         = [string]$d.FriendlyName
    class        = [string]$d.Class
    status       = [string]$d.Status
    problemCode  = $code
    manufacturer = [string]$d.Manufacturer
    service      = [string]$d.Service
    present      = [bool]$d.Present
  } | ConvertTo-Json -Compress
}
"#;

fn to_device(raw: RawDevice) -> Option<DeviceInfo> {
  let instance_id = raw.instance_id.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())?;
  let status = raw.status.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "Unknown".to_string());
  let problem_text = problem_text(raw.problem_code);
  let health = if raw.problem_code != 0 || status.eq_ignore_ascii_case("Error") {
    "error"
  } else if status.eq_ignore_ascii_case("Degraded") || status.eq_ignore_ascii_case("Unknown") {
    "warn"
  } else {
    "ok"
  };
  let class = raw.class.map(|c| c.trim().to_string()).filter(|c| !c.is_empty());
  let name = raw
    .name
    .map(|n| n.trim().to_string())
    .filter(|n| !n.is_empty())
    .unwrap_or_else(|| "Unknown device".to_string());
  Some(DeviceInfo {
    category: category(class.as_deref()),
    class,
    name,
    manufacturer: raw.manufacturer.map(|m| m.trim().to_string()).filter(|m| !m.is_empty()),
    service: raw.service.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
    status,
    problem_code: raw.problem_code,
    problem_text,
    health,
    present: raw.present,
    instance_id,
  })
}

/// Every Plug-and-Play device currently present. Absent (unplugged) devices are
/// filtered out so the overview reflects what is connected now.
pub fn list() -> Result<Vec<DeviceInfo>, String> {
  let raw: Vec<RawDevice> = query_lines("Could not read the connected devices", DEVICES_SCRIPT)?;
  let mut devices: Vec<DeviceInfo> = raw.into_iter().filter(|d| d.present).filter_map(to_device).collect();
  // Problem devices first, then by category and name.
  devices.sort_by(|a, b| {
    let rank = |d: &DeviceInfo| if d.health == "error" { 0 } else if d.health == "warn" { 1 } else { 2 };
    rank(a)
      .cmp(&rank(b))
      .then_with(|| a.category.cmp(b.category))
      .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
  });
  Ok(devices)
}

// ---------------------------------------------------------------------------
// Drivers

#[derive(Debug, Clone, Deserialize)]
struct RawDriver {
  #[serde(default)]
  device_name: Option<String>,
  #[serde(default)]
  provider: Option<String>,
  #[serde(default)]
  version: Option<String>,
  #[serde(default)]
  date: Option<String>,
  #[serde(default)]
  class: Option<String>,
  #[serde(default)]
  manufacturer: Option<String>,
}

/// An installed device driver as presented to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverInfo {
  pub device_name: String,
  pub provider: Option<String>,
  pub version: Option<String>,
  /// The driver date as `YYYY-MM-DD`, when Windows reports it.
  pub date: Option<String>,
  pub category: &'static str,
  pub class: Option<String>,
  pub manufacturer: Option<String>,
}

const DRIVERS_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
foreach ($d in Get-CimInstance -ClassName Win32_PnPSignedDriver -ErrorAction Stop) {
  if (-not $d.DeviceName) { continue }
  $date = $null
  if ($d.DriverDate) {
    try { $date = ([datetime]$d.DriverDate).ToString('yyyy-MM-dd') }
    catch {
      $s = [string]$d.DriverDate
      if ($s.Length -ge 8) { $date = $s.Substring(0,4) + '-' + $s.Substring(4,2) + '-' + $s.Substring(6,2) }
    }
  }
  [pscustomobject]@{
    deviceName   = [string]$d.DeviceName
    provider     = [string]$d.DriverProviderName
    version      = [string]$d.DriverVersion
    date         = $date
    class        = [string]$d.DeviceClass
    manufacturer = [string]$d.Manufacturer
  } | ConvertTo-Json -Compress
}
"#;

/// Every signed device driver Windows reports.
pub fn drivers() -> Result<Vec<DriverInfo>, String> {
  let raw: Vec<RawDriver> = query_lines("Could not read the installed drivers", DRIVERS_SCRIPT)?;
  let mut drivers: Vec<DriverInfo> = raw
    .into_iter()
    .filter_map(|d| {
      let device_name = d.device_name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty())?;
      let class = d.class.map(|c| c.trim().to_string()).filter(|c| !c.is_empty());
      Some(DriverInfo {
        category: category(class.as_deref()),
        device_name,
        provider: d.provider.map(|p| p.trim().to_string()).filter(|p| !p.is_empty()),
        version: d.version.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()),
        date: d.date.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()),
        class,
        manufacturer: d.manufacturer.map(|m| m.trim().to_string()).filter(|m| !m.is_empty()),
      })
    })
    .collect();
  drivers.sort_by(|a, b| a.category.cmp(b.category).then_with(|| a.device_name.to_lowercase().cmp(&b.device_name.to_lowercase())));
  drivers.dedup_by(|a, b| a.device_name == b.device_name && a.version == b.version && a.provider == b.provider);
  Ok(drivers)
}

/// Opens the native Windows Device Manager console.
pub fn open_device_manager() -> AppResult<()> {
  process::launch(&process::system32("mmc.exe"), &["devmgmt.msc"]).map_err(AppError::Network)
}

/// Opens the native Device Manager properties dialog for one device, through
/// the documented `devmgr.dll` entry point, after validating the instance ID.
pub fn open_device_properties(instance_id: &str) -> AppResult<()> {
  let id = validate::instance_id(instance_id)?;
  process::launch(
    &process::system32("rundll32.exe"),
    &["devmgr.dll,DeviceProperties_RunDLL", &format!("/DeviceID {id}")],
  )
  .map_err(AppError::Network)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn categories_map_known_classes() {
    assert_eq!(category(Some("USB")), "USB");
    assert_eq!(category(Some("Net")), "Network adapters");
    assert_eq!(category(Some("Display")), "Display adapters");
    assert_eq!(category(Some("Media")), "Audio");
    assert_eq!(category(None), "Other devices");
    assert_eq!(category(Some("SomethingNew")), "Other devices");
  }

  #[test]
  fn problem_text_is_only_present_for_faults() {
    assert!(problem_text(0).is_none());
    assert!(problem_text(28).unwrap().contains("not installed"));
    assert!(problem_text(999).unwrap().contains("999"));
  }
}
