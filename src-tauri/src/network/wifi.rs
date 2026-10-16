//! Reveals the saved password of the Wi-Fi network this computer is connected
//! to. The key is read through the WLAN API; when Windows keeps it encrypted
//! for a non-elevated caller, an elevated `netsh` export is used instead,
//! which asks for UAC approval. The key is returned to the UI only; it is
//! never logged or written to the database.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use super::process::{self, Elevated};
use super::sys;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiPassword {
  pub ssid: String,
  pub profile: String,
  /// Windows' authentication name, e.g. `WPA2PSK`, `WPA3SAE` or `open`.
  pub authentication: String,
  /// `None` for open networks, which have no password.
  pub password: Option<String>,
}

/// A temporary folder that is deleted, with everything in it, when dropped.
/// The exported profile holds the key in plain text, so it must not linger.
struct TempFolder(PathBuf);

impl TempFolder {
  fn new() -> AppResult<Self> {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let path = std::env::temp_dir().join(format!("vocatechx-wifi-{}-{nanos}", std::process::id()));
    std::fs::create_dir(&path).map_err(|e| AppError::Network(format!("Could not create a temporary folder: {e}")))?;
    Ok(Self(path))
  }
}

impl Drop for TempFolder {
  fn drop(&mut self) {
    if let Err(e) = std::fs::remove_dir_all(&self.0) {
      log::warn!("could not remove temporary Wi-Fi export folder: {e}");
    }
  }
}

/// The password for the network `adapter_id` (an adapter GUID) is connected
/// to. Returns `Ok(None)` if the administrator prompt was declined.
pub fn connected_password(adapter_id: &str) -> AppResult<Option<WifiPassword>> {
  let connections = sys::wifi_connections()
    .map_err(|code| AppError::Network(format!("Windows could not read the Wi-Fi connection (error {code}).")))?;
  let connection = connections
    .iter()
    .find(|c| c.interface_guid.eq_ignore_ascii_case(adapter_id))
    .or_else(|| connections.first())
    .ok_or_else(|| AppError::Network("This Wi-Fi adapter is not connected to a network.".into()))?;
  if connection.profile.is_empty() {
    return Err(AppError::Network("Windows did not report which saved Wi-Fi profile is in use.".into()));
  }

  // Ask Windows directly first. Whether the key comes back in plain text
  // without elevation depends on the Windows build and account, so only fall
  // back to the administrator prompt when it is still encrypted.
  let direct = sys::wifi_profile_xml(&connection.profile);
  let xml = match direct {
    Ok(xml) if !is_protected(&xml) => xml,
    Ok(_) if sys::is_elevated() => {
      return Err(AppError::Network("Windows returned the password in encrypted form even with administrator rights.".into()));
    }
    Err(code) if sys::is_elevated() => {
      return Err(AppError::Network(format!("Windows could not read the saved Wi-Fi profile (error {code}).")));
    }
    _ => match export_profile_elevated(&connection.profile)? {
      Some(xml) => xml,
      None => return Ok(None),
    },
  };

  let authentication = tag(&xml, "authentication").unwrap_or_default();
  let password = if authentication.eq_ignore_ascii_case("open") {
    None
  } else {
    if is_protected(&xml) {
      return Err(AppError::Network("Windows returned the password in encrypted form. Administrator rights are required.".into()));
    }
    Some(tag(&xml, "keyMaterial").ok_or_else(|| {
      AppError::Network("This network does not use a saved password (it may use a company sign-in instead).".into())
    })?)
  };

  Ok(Some(WifiPassword { ssid: connection.ssid.clone(), profile: connection.profile.clone(), authentication, password }))
}

/// Exports one profile with its key via an elevated `netsh`, reads it, and
/// deletes the export immediately.
fn export_profile_elevated(profile: &str) -> AppResult<Option<String>> {
  let folder = TempFolder::new()?;
  let script = format!(
    "$netsh = Join-Path $env:SystemRoot 'System32\\netsh.exe'\n\
     & $netsh wlan export profile ('name=' + {}) key=clear ('folder=' + {}) | Out-Null\n\
     exit $LASTEXITCODE",
    process::ps_quote(profile),
    process::ps_quote(&folder.0.to_string_lossy()),
  );
  match process::powershell_elevated(&script, Duration::from_secs(60)).map_err(AppError::Network)? {
    Elevated::Cancelled => Ok(None),
    Elevated::Completed(_) => read_export(&folder.0, profile).map(Some),
  }
}

fn read_export(folder: &Path, profile: &str) -> AppResult<String> {
  let entries = std::fs::read_dir(folder).map_err(|e| AppError::Network(format!("Could not read the exported profile: {e}")))?;
  let mut fallback = None;
  for entry in entries.flatten() {
    let Ok(xml) = std::fs::read_to_string(entry.path()) else { continue };
    if tag(&xml, "name").as_deref() == Some(profile) {
      return Ok(xml);
    }
    fallback.get_or_insert(xml);
  }
  fallback.ok_or_else(|| AppError::Network("Windows did not export the Wi-Fi profile, so the password could not be read.".into()))
}

/// The profile's key is present but encrypted (not readable without elevation).
fn is_protected(xml: &str) -> bool {
  tag(xml, "protected").is_some_and(|p| p.eq_ignore_ascii_case("true"))
}

/// The text of the first `<name>…</name>` element, with XML entities decoded.
fn tag(xml: &str, name: &str) -> Option<String> {
  let open = format!("<{name}>");
  let close = format!("</{name}>");
  let start = xml.find(&open)? + open.len();
  let end = start + xml[start..].find(&close)?;
  Some(
    xml[start..end]
      .replace("&lt;", "<")
      .replace("&gt;", ">")
      .replace("&quot;", "\"")
      .replace("&apos;", "'")
      .replace("&amp;", "&"),
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  const PROFILE: &str = r#"<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>Lab &amp; Office</name>
  <SSIDConfig><SSID><name>Lab &amp; Office</name></SSID></SSIDConfig>
  <MSM><security>
    <authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption></authEncryption>
    <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>p&lt;ss&amp;word</keyMaterial></sharedKey>
  </security></MSM>
</WLANProfile>"#;

  #[test]
  fn reads_profile_fields_and_decodes_entities() {
    assert_eq!(tag(PROFILE, "name").as_deref(), Some("Lab & Office"));
    assert_eq!(tag(PROFILE, "authentication").as_deref(), Some("WPA2PSK"));
    assert_eq!(tag(PROFILE, "keyMaterial").as_deref(), Some("p<ss&word"));
    assert_eq!(tag(PROFILE, "missing"), None);
  }

  #[test]
  fn export_is_matched_by_profile_name_and_folder_is_removed() {
    let folder = TempFolder::new().unwrap();
    std::fs::write(folder.0.join("Wi-Fi-Other.xml"), PROFILE.replace("Lab &amp; Office", "Other")).unwrap();
    std::fs::write(folder.0.join("Wi-Fi-Lab.xml"), PROFILE).unwrap();
    let xml = read_export(&folder.0, "Lab & Office").unwrap();
    assert_eq!(tag(&xml, "name").as_deref(), Some("Lab & Office"));

    let path = folder.0.clone();
    drop(folder);
    assert!(!path.exists());
  }

  #[cfg(windows)]
  #[test]
  fn wlan_api_is_callable() {
    // Machines without Wi-Fi report ERROR_SERVICE_NOT_ACTIVE (1062); either way it must not crash.
    let _ = sys::wifi_connections();
  }
}
