//! The `application` folder: finding installers, reading and writing each
//! app's `app.json`, and checking both before anything is offered for install.
//!
//! Layout: `application/<app folder>/<installer>.msi|.exe` plus `app.json`.
//! An installer with no `app.json` (loose in `application/`, or alone in a
//! folder) is reported as pending until the technician sets it up.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const CONFIG_FILE: &str = "app.json";

/// Categories offered in the setup dialog and used by the catalog filter.
pub const CATEGORIES: &[&str] = &[
  "Browsers",
  "Compression",
  "Media",
  "Documents",
  "Development",
  "Utilities",
  "File transfer",
  "Communication",
  "Runtimes",
  "Security",
  "Other",
];

/// `app.json` is small; anything larger is not one VocaTechX wrote.
const MAX_CONFIG_BYTES: u64 = 64 * 1024;

/// How an installer is run silently. Each type maps to that installer
/// technology's documented unattended switches (see `install::command`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallerType {
  /// Windows Installer package, run through msiexec.
  Msi,
  /// Inno Setup.
  Inno,
  /// Nullsoft (NSIS).
  Nsis,
  /// WiX Burn bundle.
  Burn,
  /// Any other installer; the technician supplies its silent switches.
  Custom,
}

impl InstallerType {
  pub fn label(self) -> &'static str {
    match self {
      Self::Msi => "Windows Installer (MSI)",
      Self::Inno => "Inno Setup",
      Self::Nsis => "Nullsoft (NSIS)",
      Self::Burn => "WiX Burn bundle",
      Self::Custom => "Custom",
    }
  }

  /// The installer file extension this type requires.
  fn extension(self) -> &'static str {
    if self == Self::Msi { "msi" } else { "exe" }
  }
}

/// The contents of an app's `app.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
  pub name: String,
  pub category: String,
  #[serde(default)]
  pub description: String,
  /// The installer's file name, in the same folder as `app.json`.
  pub installer: String,
  #[serde(rename = "type")]
  pub installer_type: InstallerType,
  /// Silent-install arguments, used only for `custom` installers.
  #[serde(default)]
  pub args: Vec<String>,
  /// Lowercase hex SHA-256 of the installer, recorded when it was set up.
  pub sha256: String,
  pub size_bytes: u64,
  #[serde(default)]
  pub version: Option<String>,
  #[serde(default)]
  pub publisher: Option<String>,
  /// Text that appears in the app's name in Windows' installed-programs list,
  /// used to check whether it is installed.
  pub detect: String,
}

/// What the technician enters in the setup dialog. `source` must be one of the
/// installers the last scan reported; everything else is validated here.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSetup {
  pub source: String,
  pub name: String,
  pub category: String,
  #[serde(default)]
  pub description: String,
  pub installer_type: InstallerType,
  #[serde(default)]
  pub args: Vec<String>,
  pub detect: String,
}

/// An app folder found by a scan.
#[derive(Debug, Clone)]
pub struct ScannedApp {
  /// The folder name, used as the app's ID.
  pub id: String,
  pub dir: PathBuf,
  pub config: Option<AppConfig>,
  /// Why the app cannot be installed, if it cannot.
  pub problem: Option<String>,
  /// The installer, as a `source` that can be set up (again).
  pub source: Option<String>,
}

impl ScannedApp {
  /// The app's config, but only when it is ready to install.
  pub fn ready(&self) -> Option<&AppConfig> {
    self.config.as_ref().filter(|_| self.problem.is_none())
  }

  pub fn installer_path(&self) -> Option<PathBuf> {
    self.config.as_ref().map(|c| self.dir.join(&c.installer))
  }
}

/// An installer that has no `app.json` yet.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInstaller {
  /// Path relative to the `application` folder, with `/` separators.
  pub source: String,
  pub file_name: String,
  /// The app folder it sits in, or `None` if it is loose in `application/`.
  pub folder: Option<String>,
  pub size_bytes: u64,
  #[serde(skip)]
  pub path: PathBuf,
}

#[derive(Debug, Default)]
pub struct Scan {
  pub apps: Vec<ScannedApp>,
  pub pending: Vec<PendingInstaller>,
}

impl Scan {
  /// Finds the installer a `source` names, among the ones this scan reported.
  /// Returns its path and the app folder it belongs to, if any.
  fn resolve_source(&self, source: &str) -> Option<(PathBuf, Option<&ScannedApp>, Option<&PendingInstaller>)> {
    if let Some(p) = self.pending.iter().find(|p| p.source == source) {
      let app = p.folder.as_deref().and_then(|f| self.apps.iter().find(|a| a.id == f));
      return Some((p.path.clone(), app, Some(p)));
    }
    let app = self.apps.iter().find(|a| a.source.as_deref() == Some(source))?;
    let file = source.rsplit('/').next()?;
    Some((app.dir.join(file), Some(app), None))
  }
}

fn is_installer(path: &Path) -> bool {
  path
    .extension()
    .and_then(|e| e.to_str())
    .is_some_and(|e| e.eq_ignore_ascii_case("msi") || e.eq_ignore_ascii_case("exe"))
}

/// Regular files and folders in `dir`, skipping hidden entries and links
/// (a link could point anywhere, so it is never followed).
fn entries(dir: &Path) -> Vec<(String, PathBuf, fs::Metadata)> {
  let Ok(read) = fs::read_dir(dir) else { return Vec::new() };
  let mut out: Vec<_> = read
    .flatten()
    .filter_map(|entry| {
      let name = entry.file_name().to_string_lossy().into_owned();
      if name.starts_with('.') {
        return None;
      }
      let meta = fs::symlink_metadata(entry.path()).ok()?;
      if meta.file_type().is_symlink() {
        return None;
      }
      Some((name, entry.path(), meta))
    })
    .collect();
  out.sort_by_key(|(name, _, _)| name.to_lowercase());
  out
}

/// Lists every app folder and every installer still waiting to be set up.
pub fn scan(folder: &Path) -> Scan {
  let mut scan = Scan::default();
  for (name, path, meta) in entries(folder) {
    if meta.is_dir() {
      scan_app_dir(&name, &path, &mut scan);
    } else if meta.is_file() && is_installer(&path) {
      scan.pending.push(PendingInstaller { source: name.clone(), file_name: name, folder: None, size_bytes: meta.len(), path });
    }
  }
  scan
}

fn scan_app_dir(id: &str, dir: &Path, scan: &mut Scan) {
  let files = entries(dir);
  let installers: Vec<_> = files.iter().filter(|(_, p, m)| m.is_file() && is_installer(p)).collect();
  let config_path = dir.join(CONFIG_FILE);

  if !files.iter().any(|(name, _, m)| m.is_file() && name.eq_ignore_ascii_case(CONFIG_FILE)) {
    // Not set up yet: every installer in it is pending. Empty folders are ignored.
    for (file, path, meta) in installers {
      scan.pending.push(PendingInstaller {
        source: format!("{id}/{file}"),
        file_name: file.clone(),
        folder: Some(id.to_string()),
        size_bytes: meta.len(),
        path: path.clone(),
      });
    }
    return;
  }

  let only_installer = (installers.len() == 1).then(|| format!("{id}/{}", installers[0].0));
  let config = match read_config(&config_path) {
    Ok(config) => config,
    Err(problem) => {
      scan.apps.push(ScannedApp { id: id.to_string(), dir: dir.to_path_buf(), config: None, problem: Some(problem), source: only_installer });
      return;
    }
  };

  let installer = dir.join(&config.installer);
  let source = Some(format!("{id}/{}", config.installer));
  let problem = match fs::symlink_metadata(&installer) {
    Err(_) => Some(format!("The installer {} is missing from this folder.", config.installer)),
    Ok(m) if !m.is_file() => Some(format!("{} is not a regular file.", config.installer)),
    Ok(m) if m.len() != config.size_bytes => {
      Some("The installer file has changed since it was set up. Set it up again to trust the new file.".to_string())
    }
    Ok(_) => None,
  };
  let source = if problem.is_some() && !installer.is_file() { only_installer } else { source };
  scan.apps.push(ScannedApp { id: id.to_string(), dir: dir.to_path_buf(), config: Some(config), problem, source });
}

fn read_config(path: &Path) -> Result<AppConfig, String> {
  let meta = fs::metadata(path).map_err(|e| format!("app.json could not be read: {e}"))?;
  if meta.len() > MAX_CONFIG_BYTES {
    return Err("app.json is too large to be a VocaTechX app file.".into());
  }
  let text = fs::read_to_string(path).map_err(|e| format!("app.json could not be read: {e}"))?;
  let config: AppConfig =
    serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| format!("app.json is not valid: {e}"))?;
  validate_config(&config)?;
  Ok(config)
}

fn check_text(label: &str, value: &str, min: usize, max: usize) -> Result<(), String> {
  let len = value.trim().chars().count();
  if len < min || len > max {
    return Err(format!("{label} must be {min}–{max} characters."));
  }
  if value.chars().any(char::is_control) {
    return Err(format!("{label} contains characters VocaTechX cannot use."));
  }
  Ok(())
}

/// Silent-install arguments for a custom installer: a few plain switches, each
/// passed to the installer as its own argument (never through a shell).
fn check_args(installer_type: InstallerType, args: &[String]) -> Result<(), String> {
  if installer_type != InstallerType::Custom {
    return if args.is_empty() { Ok(()) } else { Err("Only custom installers take their own switches.".into()) };
  }
  if args.is_empty() {
    return Err("Enter the switches that make this installer run silently (see its documentation).".into());
  }
  if args.len() > 20 {
    return Err("Use at most 20 switches.".into());
  }
  for arg in args {
    check_text("Each switch", arg, 1, 200)?;
  }
  Ok(())
}

fn validate_config(c: &AppConfig) -> Result<(), String> {
  check_text("The name", &c.name, 1, 80)?;
  check_text("The description", &c.description, 0, 240)?;
  check_text("The installed-program name", &c.detect, 2, 120)?;
  if !CATEGORIES.contains(&c.category.as_str()) {
    return Err(format!("\"{}\" is not a known category.", c.category));
  }
  let file = Path::new(&c.installer);
  if c.installer.is_empty() || file.file_name().map(|f| f != file.as_os_str()).unwrap_or(true) || c.installer.contains(['/', '\\']) {
    return Err("app.json must name an installer file in the same folder.".into());
  }
  let ext_ok = file.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case(c.installer_type.extension()));
  if !ext_ok {
    return Err(format!("A {} installer must be a .{} file.", c.installer_type.label(), c.installer_type.extension()));
  }
  check_args(c.installer_type, &c.args)?;
  if c.sha256.len() != 64 || !c.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
    return Err("app.json has no valid installer checksum. Set the app up again.".into());
  }
  Ok(())
}

/// Lowercase hex SHA-256 of everything `reader` yields.
pub fn sha256(mut reader: impl Read) -> std::io::Result<String> {
  let mut hasher = Sha256::new();
  let mut buffer = vec![0u8; 1 << 20];
  loop {
    let n = reader.read(&mut buffer)?;
    if n == 0 {
      break;
    }
    hasher.update(&buffer[..n]);
  }
  Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// A folder name for a new app: lowercase letters, digits and dashes.
fn slug(name: &str) -> String {
  let mut out = String::new();
  for c in name.chars().flat_map(char::to_lowercase) {
    if c.is_ascii_alphanumeric() {
      out.push(c);
    } else if !out.ends_with('-') && !out.is_empty() {
      out.push('-');
    }
  }
  let out: String = out.trim_end_matches('-').chars().take(40).collect();
  if out.is_empty() { "app".into() } else { out.trim_end_matches('-').to_string() }
}

fn unused_dir(folder: &Path, base: &str) -> PathBuf {
  let mut candidate = folder.join(base);
  let mut n = 2;
  while fs::symlink_metadata(&candidate).is_ok() {
    candidate = folder.join(format!("{base}-{n}"));
    n += 1;
  }
  candidate
}

/// Sets up (or re-trusts) one installer: validates what the technician
/// entered, moves a loose installer into its own folder, records the file's
/// SHA-256 and size, and writes `app.json`. Returns the app's folder and config.
///
/// `metadata` reads the installer's version and signer (see `inspect`); it is
/// a parameter so tests can run without PowerShell.
pub fn save(
  folder: &Path,
  setup: &AppSetup,
  metadata: impl Fn(&Path) -> (Option<String>, Option<String>),
) -> Result<(PathBuf, AppConfig), String> {
  let scan = scan(folder);
  let (path, app, pending) = scan
    .resolve_source(&setup.source)
    .ok_or("That installer is no longer in the application folder. Refresh the list.")?;
  let file_name = path.file_name().map(|f| f.to_string_lossy().into_owned()).ok_or("That installer has no file name.")?;

  let mut config = AppConfig {
    name: setup.name.trim().to_string(),
    category: setup.category.trim().to_string(),
    description: setup.description.trim().to_string(),
    installer: file_name.clone(),
    installer_type: setup.installer_type,
    args: setup.args.iter().map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect(),
    sha256: "0".repeat(64),
    size_bytes: 0,
    version: None,
    publisher: None,
    detect: setup.detect.trim().to_string(),
  };
  validate_config(&config)?;

  // A loose installer gets its own folder, named after the app.
  let dir = match (app, pending) {
    (Some(app), _) => app.dir.clone(),
    (None, Some(p)) if p.folder.is_none() => {
      let dir = unused_dir(folder, &slug(&config.name));
      fs::create_dir(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
      fs::rename(&path, dir.join(&file_name)).map_err(|e| {
        let _ = fs::remove_dir(&dir);
        format!("Could not move {file_name} into its own folder: {e}")
      })?;
      dir
    }
    (None, _) => path.parent().map(Path::to_path_buf).ok_or("That installer has no folder.")?,
  };
  let installer = dir.join(&file_name);

  let file = fs::File::open(&installer).map_err(|e| format!("Could not open {file_name}: {e}"))?;
  config.size_bytes = file.metadata().map_err(|e| format!("Could not read {file_name}: {e}"))?.len();
  config.sha256 = sha256(file).map_err(|e| format!("Could not read {file_name}: {e}"))?;
  // Editing a working app keeps trusting the same file; a different file must
  // go through "Set up again", where its signature is shown.
  if let Some(existing) = app.and_then(ScannedApp::ready)
    && !existing.sha256.eq_ignore_ascii_case(&config.sha256)
  {
    return Err("The installer file changed while you were editing. Refresh the list and set it up again.".into());
  }
  let (version, publisher) = metadata(&installer);
  config.version = version;
  config.publisher = publisher;

  // Write to a temporary file first so a half-written app.json never appears.
  let json = serde_json::to_string_pretty(&config).map_err(|e| format!("Could not save app.json: {e}"))?;
  let temp = dir.join(".app.json.tmp");
  fs::write(&temp, json).map_err(|e| format!("Could not save app.json in {}: {e}", dir.display()))?;
  fs::rename(&temp, dir.join(CONFIG_FILE)).map_err(|e| {
    let _ = fs::remove_file(&temp);
    format!("Could not save app.json in {}: {e}", dir.display())
  })?;
  Ok((dir, config))
}

/// Finds the installer a `source` names (for the setup dialog's inspection).
pub fn source_path(folder: &Path, source: &str) -> Option<PathBuf> {
  scan(folder).resolve_source(source).map(|(path, _, _)| path)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn setup(source: &str, installer_type: InstallerType) -> AppSetup {
    AppSetup {
      source: source.into(),
      name: "VLC media player".into(),
      category: "Media".into(),
      description: String::new(),
      installer_type,
      args: Vec::new(),
      detect: "VLC media player".into(),
    }
  }

  fn no_metadata(_: &Path) -> (Option<String>, Option<String>) {
    (Some("3.0.24".into()), Some("VideoLAN".into()))
  }

  #[test]
  fn loose_installer_is_pending_then_set_up_into_its_own_folder() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("vlc-3.0.24-win64.msi"), b"fake msi").unwrap();
    fs::write(dir.path().join("README.md"), b"ignored").unwrap();

    let before = scan(dir.path());
    assert!(before.apps.is_empty());
    assert_eq!(before.pending.len(), 1);
    assert_eq!(before.pending[0].source, "vlc-3.0.24-win64.msi");

    let (_, config) = save(dir.path(), &setup("vlc-3.0.24-win64.msi", InstallerType::Msi), no_metadata).unwrap();
    assert_eq!(config.size_bytes, 8);
    assert_eq!(config.sha256, sha256(&b"fake msi"[..]).unwrap());
    assert_eq!(config.version.as_deref(), Some("3.0.24"));

    let after = scan(dir.path());
    assert!(after.pending.is_empty());
    assert_eq!(after.apps.len(), 1);
    assert_eq!(after.apps[0].id, "vlc-media-player");
    assert!(after.apps[0].ready().is_some(), "{:?}", after.apps[0].problem);
    assert!(dir.path().join("vlc-media-player").join("vlc-3.0.24-win64.msi").is_file());
  }

  #[test]
  fn editing_keeps_the_same_trusted_file() {
    let dir = tempfile::tempdir().unwrap();
    let app = dir.path().join("vlc");
    fs::create_dir(&app).unwrap();
    fs::write(app.join("vlc.msi"), b"original").unwrap();
    save(dir.path(), &setup("vlc/vlc.msi", InstallerType::Msi), no_metadata).unwrap();

    let mut edit = setup("vlc/vlc.msi", InstallerType::Msi);
    edit.name = "VLC".into();
    edit.category = "Utilities".into();
    let (_, saved) = save(dir.path(), &edit, no_metadata).unwrap();
    assert_eq!((saved.name.as_str(), saved.category.as_str()), ("VLC", "Utilities"));
    assert_eq!(scan(dir.path()).apps[0].ready().unwrap().name, "VLC");
  }

  #[test]
  fn changed_or_missing_installer_is_a_problem() {
    let dir = tempfile::tempdir().unwrap();
    let app = dir.path().join("vlc");
    fs::create_dir(&app).unwrap();
    fs::write(app.join("vlc.msi"), b"original").unwrap();
    save(dir.path(), &setup("vlc/vlc.msi", InstallerType::Msi), no_metadata).unwrap();
    assert!(scan(dir.path()).apps[0].ready().is_some());

    fs::write(app.join("vlc.msi"), b"replaced with something else").unwrap();
    let changed = scan(dir.path());
    assert!(changed.apps[0].problem.as_deref().unwrap().contains("changed"));
    assert_eq!(changed.apps[0].source.as_deref(), Some("vlc/vlc.msi"), "can be set up again");

    fs::remove_file(app.join("vlc.msi")).unwrap();
    assert!(scan(dir.path()).apps[0].problem.as_deref().unwrap().contains("missing"));
  }

  #[test]
  fn rejects_bad_setups() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("setup.exe"), b"x").unwrap();

    assert!(save(dir.path(), &setup("..\\..\\Windows\\notepad.exe", InstallerType::Inno), no_metadata).is_err());
    assert!(save(dir.path(), &setup("setup.exe", InstallerType::Msi), no_metadata).unwrap_err().contains(".msi"));
    assert!(save(dir.path(), &setup("setup.exe", InstallerType::Custom), no_metadata).unwrap_err().contains("switches"));
    let mut bad = setup("setup.exe", InstallerType::Inno);
    bad.category = "Games".into();
    assert!(save(dir.path(), &bad, no_metadata).is_err());
    let mut bad = setup("setup.exe", InstallerType::Inno);
    bad.args = vec!["/S".into()];
    assert!(save(dir.path(), &bad, no_metadata).is_err());
    // Nothing was moved or written by the rejected attempts.
    assert!(dir.path().join("setup.exe").is_file());
    assert_eq!(scan(dir.path()).pending.len(), 1);
  }

  #[test]
  fn invalid_app_json_is_reported_not_trusted() {
    let dir = tempfile::tempdir().unwrap();
    let app = dir.path().join("tool");
    fs::create_dir(&app).unwrap();
    fs::write(app.join("tool.exe"), b"x").unwrap();
    fs::write(app.join(CONFIG_FILE), br#"{"name":"Tool","installer":"..\\evil.exe"}"#).unwrap();
    let scanned = scan(dir.path());
    assert!(scanned.apps[0].ready().is_none());
    assert_eq!(scanned.apps[0].source.as_deref(), Some("tool/tool.exe"));
  }

  #[test]
  fn slugs_are_folder_safe() {
    assert_eq!(slug("Google Chrome"), "google-chrome");
    assert_eq!(slug("Notepad++"), "notepad");
    assert_eq!(slug("  7-Zip  "), "7-zip");
    assert_eq!(slug("???"), "app");
  }
}
