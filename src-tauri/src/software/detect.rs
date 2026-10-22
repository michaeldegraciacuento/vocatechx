//! Whether an app is installed, read from the same registry "Uninstall" keys
//! that Windows' Apps & features list uses (64-bit, 32-bit and per-user).

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

use crate::devices::query_lines;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledProgram {
  pub name: String,
  #[serde(default)]
  pub version: Option<String>,
  /// The registry key that lists the program, which identifies this entry.
  #[serde(default)]
  pub key: String,
  /// The key's own name: the product code for Windows Installer entries.
  #[serde(default)]
  pub key_name: Option<String>,
  #[serde(default)]
  pub windows_installer: bool,
  #[serde(default)]
  pub uninstall: Option<String>,
  #[serde(default)]
  pub quiet_uninstall: Option<String>,
  /// The icon Settings › Apps shows, as `path` or `path,index`.
  #[serde(default)]
  pub display_icon: Option<String>,
}

const PROGRAMS_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$paths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($path in $paths) {
  foreach ($k in (Get-ItemProperty -Path $path)) {
    if (-not $k.DisplayName -or $k.ParentKeyName) { continue }
    [pscustomobject]@{
      name             = [string]$k.DisplayName
      version          = [string]$k.DisplayVersion
      key              = [string]$k.PSPath
      keyName          = [string]$k.PSChildName
      windowsInstaller = ($k.WindowsInstaller -eq 1)
      uninstall        = [string]$k.UninstallString
      quietUninstall   = [string]$k.QuietUninstallString
      displayIcon      = [string]$k.DisplayIcon
    } | ConvertTo-Json -Compress
  }
}
"#;

/// Every program Windows lists as installed (updates and patches excluded).
pub fn installed_programs() -> Result<Vec<InstalledProgram>, String> {
  query_lines("Could not read the installed programs", PROGRAMS_SCRIPT)
}

/// The installed program whose name contains `detect` (ignoring case). An
/// exact name beats one that starts with `detect`, which beats one that merely
/// contains it, so "Git" finds Git rather than GitHub Desktop. Among equally
/// good matches the highest version wins.
pub fn find<'a>(programs: &'a [InstalledProgram], detect: &str) -> Option<&'a InstalledProgram> {
  let needle = detect.trim().to_lowercase();
  if needle.is_empty() {
    return None;
  }
  let rank = |p: &InstalledProgram| {
    let name = p.name.to_lowercase();
    if name == needle {
      2
    } else if name.starts_with(&needle) {
      1
    } else {
      0
    }
  };
  programs.iter().filter(|p| p.name.to_lowercase().contains(&needle)).max_by(|a, b| {
    rank(a).cmp(&rank(b)).then_with(|| match (a.version.as_deref(), b.version.as_deref()) {
      (Some(x), Some(y)) => compare_versions(x, y).unwrap_or(Ordering::Equal),
      (Some(_), None) => Ordering::Greater,
      (None, Some(_)) => Ordering::Less,
      (None, None) => Ordering::Equal,
    })
  })
}

/// The numeric parts of a version, with trailing zeros dropped so `26.05` and
/// `26.05.00.0` compare equal. `None` if it does not start with a number.
fn parse_version(value: &str) -> Option<Vec<u64>> {
  // Some installers report `1, 4, 1, 1032` instead of `1.4.1.1032`.
  let digits: String = value.trim().chars().take_while(|c| c.is_ascii_digit() || matches!(c, '.' | ',' | ' ')).collect();
  let mut parts: Vec<u64> = digits
    .split(['.', ','])
    .map(str::trim)
    .filter(|s| !s.is_empty())
    .map(|s| s.parse().ok())
    .collect::<Option<_>>()?;
  if parts.is_empty() {
    return None;
  }
  while parts.len() > 1 && parts.last() == Some(&0) {
    parts.pop();
  }
  Some(parts)
}

/// Compares two version strings numerically, or `None` if either cannot be
/// read. Callers treat `None` as "unknown", never as "up to date".
pub fn compare_versions(a: &str, b: &str) -> Option<Ordering> {
  Some(parse_version(a)?.cmp(&parse_version(b)?))
}

/// How an app's installer compares with what is installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallState {
  NotInstalled,
  /// Installed, but the versions cannot be compared.
  Installed,
  /// The installed version is the installer's version.
  UpToDate,
  /// The installer is newer than what is installed.
  UpdateAvailable,
  /// What is installed is newer than the installer; installing would downgrade.
  NewerInstalled,
}

pub fn state(installed: Option<&InstalledProgram>, installer_version: Option<&str>) -> InstallState {
  let Some(program) = installed else { return InstallState::NotInstalled };
  match (program.version.as_deref(), installer_version) {
    (Some(have), Some(offer)) => match compare_versions(have, offer) {
      Some(Ordering::Equal) => InstallState::UpToDate,
      Some(Ordering::Less) => InstallState::UpdateAvailable,
      Some(Ordering::Greater) => InstallState::NewerInstalled,
      None => InstallState::Installed,
    },
    _ => InstallState::Installed,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn program(name: &str, version: Option<&str>) -> InstalledProgram {
    InstalledProgram { name: name.into(), version: version.map(Into::into), ..Default::default() }
  }

  #[test]
  fn compares_versions_numerically() {
    assert_eq!(compare_versions("3.0.24", "3.0.9"), Some(Ordering::Greater));
    assert_eq!(compare_versions("26.05.00.0", "26.05"), Some(Ordering::Equal));
    assert_eq!(compare_versions("156.0.8078.48", "156.0.8078.48"), Some(Ordering::Equal));
    assert_eq!(compare_versions("1, 4, 1, 1032", "1.4.1.1032"), Some(Ordering::Equal));
    assert_eq!(compare_versions("8.9.8.1", "8.10"), Some(Ordering::Less));
    assert_eq!(compare_versions("unknown", "1.0"), None);
  }

  #[test]
  fn finds_by_name_and_prefers_the_newest() {
    let programs = vec![
      program("Mozilla Firefox (x64 en-US)", Some("157.0.1")),
      program("VLC media player", Some("3.0.20")),
      program("VLC media player", Some("3.0.24")),
    ];
    assert_eq!(find(&programs, "firefox").unwrap().name, "Mozilla Firefox (x64 en-US)");
    assert_eq!(find(&programs, "VLC media player").unwrap().version.as_deref(), Some("3.0.24"));
    assert!(find(&programs, "7-Zip").is_none());

    let git = vec![program("GitHub Desktop", Some("3.5.2")), program("Git", Some("2.55.0")), program("TortoiseGit", Some("9.0"))];
    assert_eq!(find(&git, "git").unwrap().name, "Git");
    assert!(find(&programs, "  ").is_none());
  }

  #[test]
  fn states_never_guess_up_to_date() {
    let vlc = program("VLC media player", Some("3.0.24"));
    assert_eq!(state(None, Some("3.0.24")), InstallState::NotInstalled);
    assert_eq!(state(Some(&vlc), Some("3.0.24")), InstallState::UpToDate);
    assert_eq!(state(Some(&vlc), Some("3.0.25")), InstallState::UpdateAvailable);
    assert_eq!(state(Some(&vlc), Some("3.0.9")), InstallState::NewerInstalled);
    assert_eq!(state(Some(&vlc), None), InstallState::Installed);
    assert_eq!(state(Some(&program("X", Some("beta"))), Some("1.0")), InstallState::Installed);
  }

  /// `cargo test software_detect_live -- --ignored --nocapture`
  #[test]
  #[ignore]
  fn software_detect_live() {
    let programs = installed_programs().unwrap();
    println!("{} installed programs", programs.len());
    assert!(!programs.is_empty());
    if let Some(git) = find(&programs, "Git") {
      println!("Git: {:?}", git.version);
    }
  }
}
