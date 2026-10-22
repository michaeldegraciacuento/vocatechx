//! App icons for the Software Center tiles.
//!
//! An icon the technician drops into the app folder as `icon.png` always wins.
//! Otherwise VocaTechX extracts one once and saves it as `.icon.png`: from the
//! installed program (the icon Settings › Apps shows), else from the installer
//! (an .exe's own icon, or the product icon stored inside an .msi).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use super::detect::{self, InstalledProgram};
use super::library::ScannedApp;
use crate::network::process::{self, ps_quote};

/// An icon the technician provides; never overwritten.
pub const CUSTOM_ICON: &str = "icon.png";
/// The icon VocaTechX extracted.
const EXTRACTED_ICON: &str = ".icon.png";
/// Marks that extraction found nothing, so it is not retried on every refresh.
const NO_ICON: &str = ".icon-none";
/// Icons are small; anything bigger is not sent to the UI.
const MAX_ICON_BYTES: u64 = 1024 * 1024;

/// The icon file to show for an app folder, if there is one.
pub fn path(dir: &Path) -> Option<PathBuf> {
  [CUSTOM_ICON, EXTRACTED_ICON].iter().map(|name| dir.join(name)).find(|p| p.is_file())
}

/// Changes whenever the icon file does, so the UI knows to fetch it again.
pub fn version(dir: &Path) -> Option<u64> {
  let meta = fs::metadata(path(dir)?).ok()?;
  let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
  Some(modified.as_millis() as u64 ^ meta.len())
}

/// The icon as a `data:` URL for an `<img>`.
pub fn data_url(dir: &Path) -> Option<String> {
  let file = path(dir)?;
  if fs::metadata(&file).ok()?.len() > MAX_ICON_BYTES {
    return None;
  }
  let bytes = fs::read(&file).ok()?;
  bytes.starts_with(b"\x89PNG").then(|| format!("data:image/png;base64,{}", process::base64(&bytes)))
}

/// Whether an app folder still needs an icon extracted.
pub fn missing(dir: &Path) -> bool {
  path(dir).is_none() && !dir.join(NO_ICON).exists()
}

/// Forgets the extracted icon (and any "nothing found" marker), so the next
/// extraction starts fresh. A custom `icon.png` is left alone.
pub fn reset(dir: &Path) {
  let _ = fs::remove_file(dir.join(EXTRACTED_ICON));
  let _ = fs::remove_file(dir.join(NO_ICON));
}

/// Where to look for one app's icon, best first.
pub struct IconJob {
  pub dir: PathBuf,
  pub installer: PathBuf,
  pub installed: Option<InstalledProgram>,
}

/// `"C:\path\app.exe",0` → (`C:\path\app.exe`, 0).
fn parse_display_icon(value: &str) -> Option<(PathBuf, i32)> {
  let value = value.trim();
  let (path, index) = match value.rsplit_once(',') {
    Some((path, index)) if index.trim().parse::<i32>().is_ok() => (path, index.trim().parse().unwrap_or(0)),
    _ => (value, 0),
  };
  let path = PathBuf::from(path.trim().trim_matches('"'));
  (path.is_absolute() && path.is_file()).then_some((path, index))
}

fn sources(job: &IconJob) -> Vec<(PathBuf, i32)> {
  let mut sources = Vec::new();
  if let Some(icon) = job.installed.as_ref().and_then(|p| p.display_icon.as_deref()).and_then(parse_display_icon) {
    sources.push(icon);
  }
  sources.push((job.installer.clone(), 0));
  sources
}

const EXTRACT_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class VtIcon {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, uint[] ids, uint count, uint flags);
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr icon);
}
'@

# The product icon stored inside an .msi, exported to a temporary file.
function Get-MsiIcon($msi, $work) {
  $wi = New-Object -ComObject WindowsInstaller.Installer
  $db = $wi.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $wi, @($msi, 0))
  try {
    $wanted = $null
    $view = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @("SELECT Value FROM Property WHERE Property='ARPPRODUCTICON'"))
    $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
    $rec = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
    if ($rec) { $wanted = $rec.GetType().InvokeMember('StringData', 'GetProperty', $null, $rec, 1) }
    $view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null) | Out-Null
    $db.GetType().InvokeMember('Export', 'InvokeMethod', $null, $db, @('Icon', $work, 'Icon.idt')) | Out-Null
  } finally {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($db)
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wi)
  }
  $icons = Join-Path $work 'Icon'
  if (-not (Test-Path -LiteralPath $icons)) { return $null }
  $files = @(Get-ChildItem -LiteralPath $icons -File)
  $match = $files | Where-Object { $_.Name -eq $wanted } | Select-Object -First 1
  if (-not $match) { $match = $files | Select-Object -First 1 }
  if ($match) { return $match.FullName }
  return $null
}

function Save-Icon($file, $index, $dest) {
  $handles = New-Object IntPtr[] 1
  $ids = New-Object uint32[] 1
  $n = [VtIcon]::PrivateExtractIcons($file, $index, 256, 256, $handles, $ids, 1, 0)
  if ($n -lt 1 -or $n -eq [uint32]::MaxValue -or $handles[0] -eq [IntPtr]::Zero) { return $false }
  try {
    $icon = [System.Drawing.Icon]::FromHandle($handles[0])
    $bitmap = $icon.ToBitmap()
    $bitmap.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    return $true
  } finally {
    [void][VtIcon]::DestroyIcon($handles[0])
  }
}

foreach ($job in @(__JOBS__)) {
  foreach ($source in $job.sources) {
    $work = Join-Path ([IO.Path]::GetTempPath()) ('vocatechx-icon-' + [guid]::NewGuid())
    try {
      $file = $source.path
      if ($file.ToLowerInvariant().EndsWith('.msi')) {
        New-Item -ItemType Directory -Path $work | Out-Null
        $file = Get-MsiIcon $source.path $work
        if (-not $file) { continue }
      }
      if (Save-Icon $file $source.index $job.dest) { break }
    } catch {
    } finally {
      if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
    }
  }
}
"#;

fn job(app: &ScannedApp, programs: &[InstalledProgram]) -> Option<IconJob> {
  let config = app.config.as_ref()?;
  Some(IconJob {
    dir: app.dir.clone(),
    installer: app.installer_path().filter(|p| p.is_file())?,
    installed: detect::find(programs, &config.detect).cloned(),
  })
}

/// Extracts icons for the apps that do not have one yet.
pub fn fill_missing(apps: &[ScannedApp], programs: &[InstalledProgram]) {
  let jobs: Vec<IconJob> = apps.iter().filter(|a| missing(&a.dir)).filter_map(|a| job(a, programs)).collect();
  extract(&jobs);
}

/// Extracts these apps' icons again, e.g. after an install made the real
/// program's icon available, or after the app was edited.
pub fn refresh(apps: &[&ScannedApp], programs: &[InstalledProgram]) {
  for app in apps {
    reset(&app.dir);
  }
  let jobs: Vec<IconJob> = apps.iter().filter_map(|a| job(a, programs)).collect();
  extract(&jobs);
}

/// Extracts icons for several apps in one PowerShell run. Apps for which no
/// icon could be found are marked, so the work is not repeated.
pub fn extract(jobs: &[IconJob]) {
  if jobs.is_empty() {
    return;
  }
  let list = jobs
    .iter()
    .map(|job| {
      let sources = sources(job)
        .iter()
        .map(|(path, index)| format!("@{{ path = {}; index = {index} }}", ps_quote(&path.to_string_lossy())))
        .collect::<Vec<_>>()
        .join(", ");
      format!("@{{ dest = {}; sources = @({sources}) }}", ps_quote(&job.dir.join(EXTRACTED_ICON).to_string_lossy()))
    })
    .collect::<Vec<_>>()
    .join(",\n");
  let script = EXTRACT_SCRIPT.replace("__JOBS__", &list);
  if let Err(e) = process::powershell(&script, Duration::from_secs(30 + 10 * jobs.len() as u64)) {
    log::warn!("could not extract app icons: {e}");
  }
  for job in jobs {
    if path(&job.dir).is_none() {
      let _ = fs::write(job.dir.join(NO_ICON), b"");
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_display_icon_values() {
    let notepad = process::system32("notepad.exe");
    let shown = notepad.to_string_lossy();
    assert_eq!(parse_display_icon(&format!("\"{shown}\",0")), Some((notepad.clone(), 0)));
    assert_eq!(parse_display_icon(&format!("{shown},-101")), Some((notepad.clone(), -101)));
    assert_eq!(parse_display_icon(&shown), Some((notepad, 0)));
    assert_eq!(parse_display_icon(r"C:\does\not\exist.exe,0"), None);
    assert_eq!(parse_display_icon("relative.exe"), None);
  }

  #[test]
  fn custom_icon_wins_and_markers_stop_retries() {
    let dir = tempfile::tempdir().unwrap();
    assert!(missing(dir.path()));
    fs::write(dir.path().join(NO_ICON), b"").unwrap();
    assert!(!missing(dir.path()));
    reset(dir.path());
    assert!(missing(dir.path()));

    fs::write(dir.path().join(EXTRACTED_ICON), b"\x89PNG extracted").unwrap();
    fs::write(dir.path().join(CUSTOM_ICON), b"\x89PNG custom").unwrap();
    assert_eq!(path(dir.path()).unwrap().file_name().unwrap(), CUSTOM_ICON);
    assert!(data_url(dir.path()).unwrap().starts_with("data:image/png;base64,"));

    fs::write(dir.path().join(CUSTOM_ICON), b"not a png").unwrap();
    assert!(data_url(dir.path()).is_none(), "only real PNGs are sent to the UI");
  }

  /// Extracts real icons: Notepad's, and those of any installers in the
  /// project's application folder (written to a temp folder, not beside them).
  /// `cargo test software_icon_live -- --ignored --nocapture`
  #[test]
  #[ignore]
  fn software_icon_live() {
    let root = tempfile::tempdir().unwrap();
    let mut jobs = vec![IconJob { dir: root.path().join("notepad"), installer: process::system32("notepad.exe"), installed: None }];
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(super::super::FOLDER_NAME);
    let scan = super::super::library::scan(&folder);
    let installers = scan.pending.into_iter().map(|p| p.path).chain(scan.apps.iter().filter_map(|a| a.installer_path()));
    for (i, installer) in installers.enumerate() {
      jobs.push(IconJob { dir: root.path().join(format!("app{i}")), installer, installed: None });
    }
    for job in &jobs {
      fs::create_dir(&job.dir).unwrap();
    }
    extract(&jobs);
    for job in &jobs {
      let size = path(&job.dir).and_then(|p| fs::metadata(p).ok()).map(|m| m.len());
      println!("{} -> {:?} bytes", job.installer.display(), size);
    }
    assert!(path(&jobs[0].dir).is_some(), "notepad.exe has an icon");
  }
}
