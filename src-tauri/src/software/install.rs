//! Runs a batch of installs, one app at a time.
//!
//! For each app: the installer is copied into a staging folder only
//! administrators can write to, opened so nothing can change it, checked
//! against the SHA-256 in `app.json`, and only then run with its silent
//! switches. The result counts as installed only when Windows then lists the
//! app. An installer that has started is never killed: cancelling stops the
//! batch after the current app, and a timeout leaves it running.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::detect::{self, InstallState, InstalledProgram};
use super::library::{self, AppConfig, InstallerType, ScannedApp};
use super::SoftwareCenter;
use crate::error::{AppError, AppResult};
use crate::network::process;

/// Longest a single installer may run before the batch stops waiting for it.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(45 * 60);
/// Windows Installer allows one installation at a time (exit code 1618).
const BUSY_RETRIES: u32 = 4;
const BUSY_WAIT: Duration = Duration::from_secs(30);
/// Free space kept on the system drive on top of the installer's own size.
const SPACE_MARGIN: u64 = 1024 * 1024 * 1024;
const MAX_BATCH: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Step {
  Copying,
  Verifying,
  Installing,
  Uninstalling,
  /// Waiting for another installation (often Windows Update) to finish.
  Waiting,
  Checking,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemStatus {
  Installed,
  Updated,
  Uninstalled,
  Skipped,
  Failed,
  Cancelled,
  /// The installer reported success but Windows does not list the app.
  Unverified,
  /// The installer was still running when the time limit passed.
  StillRunning,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemResult {
  pub id: String,
  pub name: String,
  pub status: ItemStatus,
  pub message: String,
  pub exit_code: Option<i32>,
  pub reboot_required: bool,
  /// The version Windows lists after the install, when known.
  pub version: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum InstallEvent {
  Step { index: usize, step: Step, message: String },
  Finished { index: usize, result: ItemResult },
}

/// How an installer's exit code is interpreted.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Outcome {
  Success { reboot: bool },
  /// Another installation is in progress; try again shortly.
  Busy,
  Cancelled(&'static str),
  Failed(String),
  /// The installer will not run until Windows restarts.
  NeedsRestart(&'static str),
}

/// Exit codes documented by Windows Installer, Inno Setup and NSIS.
pub(super) fn classify(installer_type: InstallerType, code: i32) -> Outcome {
  match code {
    0 => return Outcome::Success { reboot: false },
    3010 | 1641 => return Outcome::Success { reboot: true },
    _ => {}
  }
  match installer_type {
    InstallerType::Msi | InstallerType::Burn => match code {
      1602 => Outcome::Cancelled("The installation was cancelled."),
      1618 => Outcome::Busy,
      1603 => Outcome::Failed("The installer hit a fatal error (1603). Another version may be installed, or a file was in use.".into()),
      1619 => Outcome::Failed("Windows could not open the installer package (1619).".into()),
      1625 => Outcome::Failed("A system policy blocks this installation (1625).".into()),
      1633 => Outcome::Failed("This installer does not support this version of Windows or this processor (1633).".into()),
      1638 => Outcome::Failed("Another version of this app is already installed (1638). Uninstall it first.".into()),
      _ => Outcome::Failed(format!("The installer failed with exit code {code}.")),
    },
    InstallerType::Inno => match code {
      1 => Outcome::Failed("The installer could not start (1).".into()),
      2 | 5 => Outcome::Cancelled("The installation was cancelled."),
      3 | 4 => Outcome::Failed(format!("The installer hit a fatal error ({code}).")),
      8 => Outcome::NeedsRestart("Windows must be restarted before this app can be installed (8)."),
      _ => Outcome::Failed(format!("The installer failed with exit code {code}.")),
    },
    InstallerType::Nsis => match code {
      1 => Outcome::Cancelled("The installation was cancelled."),
      2 => Outcome::Failed("The installer stopped with an error (2).".into()),
      _ => Outcome::Failed(format!("The installer failed with exit code {code}.")),
    },
    InstallerType::Custom => Outcome::Failed(format!("The installer exited with code {code}.")),
  }
}

/// The program and arguments that run `installer` silently.
fn command(config: &AppConfig, installer: &Path) -> (PathBuf, Vec<String>) {
  let path = installer.to_string_lossy().into_owned();
  let fixed = |args: &[&str]| args.iter().map(|a| a.to_string()).collect::<Vec<_>>();
  match config.installer_type {
    InstallerType::Msi => (process::system32("msiexec.exe"), vec!["/i".into(), path, "/qn".into(), "/norestart".into()]),
    InstallerType::Inno => (installer.into(), fixed(&["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"])),
    InstallerType::Nsis => (installer.into(), fixed(&["/S"])),
    InstallerType::Burn => (installer.into(), fixed(&["/quiet", "/norestart"])),
    InstallerType::Custom => (installer.into(), config.args.clone()),
  }
}

pub(super) enum RunOutcome {
  Exited(i32),
  StillRunning,
}

fn run_installer(program: &Path, args: &[String], working_dir: &Path, timeout: Duration) -> Result<RunOutcome, String> {
  let mut command = Command::new(program);
  command.args(args).current_dir(working_dir);
  wait(command, timeout)
}

/// Starts an installer or uninstaller and waits for it, up to `timeout`. On
/// timeout it is left running: killing one mid-way can break the app.
pub(super) fn wait(mut command: Command, timeout: Duration) -> Result<RunOutcome, String> {
  command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
  }
  let mut child = command.spawn().map_err(|e| format!("Windows could not start it: {e}"))?;
  let started = Instant::now();
  loop {
    match child.try_wait() {
      Ok(Some(status)) => return Ok(RunOutcome::Exited(status.code().unwrap_or(-1))),
      Ok(None) if started.elapsed() < timeout => std::thread::sleep(Duration::from_millis(250)),
      Ok(None) => return Ok(RunOutcome::StillRunning),
      Err(e) => return Err(format!("Lost track of the installer: {e}")),
    }
  }
}

// ---------------------------------------------------------------------------
// Staging

/// Creates `dir` if needed and restricts it to Administrators and SYSTEM, so a
/// standard user cannot swap an installer between verification and execution.
/// A link in its place is refused rather than followed.
fn secure_dir(dir: &Path) -> Result<(), String> {
  match fs::symlink_metadata(dir) {
    Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
      return Err(format!("{} is not a normal folder, so VocaTechX will not use it.", dir.display()));
    }
    Ok(_) => {}
    Err(_) => fs::create_dir(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?,
  }
  let path = dir.to_string_lossy();
  let icacls = process::system32("icacls.exe");
  for args in [
    vec![path.as_ref(), "/setowner", "*S-1-5-32-544"],
    vec![path.as_ref(), "/inheritance:r", "/grant:r", "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F"],
  ] {
    let output = process::run(&icacls, &args, Duration::from_secs(30))?;
    if !output.success() {
      return Err(format!("Could not secure {}: {}", dir.display(), output.text()));
    }
  }
  Ok(())
}

/// A fresh staging folder for this batch under
/// `%ProgramData%\VocaTechX\staging`, removed when dropped.
struct Staging(PathBuf);

impl Staging {
  fn create() -> Result<Self, String> {
    let program_data = std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    let root = program_data.join("VocaTechX");
    let staging = root.join("staging");
    secure_dir(&root)?;
    secure_dir(&staging)?;
    // Leftovers from a batch that was interrupted (power loss, crash).
    if let Ok(old) = fs::read_dir(&staging) {
      for entry in old.flatten() {
        let _ = fs::remove_dir_all(entry.path());
      }
    }
    let run = staging.join(format!("run-{}", crate::auth::now()));
    fs::create_dir(&run).map_err(|e| format!("Could not create {}: {e}", run.display()))?;
    Ok(Self(run))
  }
}

impl Drop for Staging {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.0);
  }
}

/// Opens a staged installer so no process can write, rename or delete it while
/// VocaTechX holds it, which is from verification until the installer exits.
fn lock(path: &Path) -> std::io::Result<fs::File> {
  let mut options = fs::OpenOptions::new();
  options.read(true);
  #[cfg(windows)]
  {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 0x1;
    options.share_mode(FILE_SHARE_READ);
  }
  options.open(path)
}

#[cfg(windows)]
fn free_space(path: &Path) -> Option<u64> {
  use std::os::windows::ffi::OsStrExt;
  use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
  let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
  let mut available = 0u64;
  let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut()) };
  (ok != 0).then_some(available)
}

#[cfg(not(windows))]
fn free_space(_path: &Path) -> Option<u64> {
  None
}

fn format_size(bytes: u64) -> String {
  format!("{:.1} GB", bytes as f64 / 1024f64.powi(3))
}

// ---------------------------------------------------------------------------
// The batch

/// Resolves the requested app IDs against a fresh scan. Every app must exist
/// and be ready, or nothing starts.
fn resolve(center: &SoftwareCenter, ids: &[String]) -> AppResult<Vec<ScannedApp>> {
  if ids.is_empty() {
    return Err(AppError::validation("Select at least one app to install."));
  }
  if ids.len() > MAX_BATCH {
    return Err(AppError::validation(format!("Install at most {MAX_BATCH} apps at a time.")));
  }
  let scan = library::scan(center.folder());
  let mut apps: Vec<ScannedApp> = Vec::new();
  for id in ids {
    if apps.iter().any(|a| &a.id == id) {
      continue;
    }
    let app = scan
      .apps
      .iter()
      .find(|a| &a.id == id)
      .ok_or_else(|| AppError::validation("One of the selected apps is no longer in the application folder. Refresh the list."))?;
    if let Some(problem) = &app.problem {
      let name = app.config.as_ref().map_or(app.id.as_str(), |c| c.name.as_str());
      return Err(AppError::validation(format!("{name} cannot be installed: {problem}")));
    }
    apps.push(app.clone());
  }
  Ok(apps)
}

pub(super) fn result(app: &ScannedApp, status: ItemStatus, message: impl Into<String>) -> ItemResult {
  ItemResult {
    id: app.id.clone(),
    name: app.config.as_ref().map_or_else(|| app.id.clone(), |c| c.name.clone()),
    status,
    message: message.into(),
    exit_code: None,
    reboot_required: false,
    version: None,
  }
}

/// Installs the apps one at a time, reporting each step through `emit`.
/// Returns one result per app, in the order they were requested.
pub fn run_batch(center: &SoftwareCenter, ids: &[String], emit: &dyn Fn(InstallEvent)) -> AppResult<Vec<ItemResult>> {
  if !crate::network::sys::is_elevated() {
    return Err(AppError::Software("Installing apps needs administrator rights. Restart VocaTechX as administrator first.".into()));
  }
  let _guard = center
    .begin_install()
    .ok_or_else(|| AppError::Software("An installation is already running.".into()))?;
  let apps = resolve(center, ids)?;
  let staging = Staging::create().map_err(AppError::Software)?;

  let mut results: Vec<ItemResult> = Vec::with_capacity(apps.len());
  let mut stop_reason: Option<String> = None;
  for (index, app) in apps.iter().enumerate() {
    let item = if let Some(reason) = &stop_reason {
      result(app, ItemStatus::Cancelled, reason.clone())
    } else if center.cancel_requested() {
      result(app, ItemStatus::Cancelled, "Not started: the installation was stopped.")
    } else {
      let step = |step: Step, message: String| emit(InstallEvent::Step { index, step, message });
      install_one(center, app, &staging.0.join(index.to_string()), &step)
    };
    if item.status == ItemStatus::StillRunning {
      stop_reason = Some(format!("Not started: {} was still installing.", item.name));
    }
    emit(InstallEvent::Finished { index, result: item.clone() });
    results.push(item);
  }
  Ok(results)
}

fn install_one(center: &SoftwareCenter, app: &ScannedApp, dir: &Path, step: &dyn Fn(Step, String)) -> ItemResult {
  let config = app.ready().expect("resolve() only returns ready apps");
  let source = app.installer_path().expect("ready apps have an installer");

  // Skip what is already installed at this version, and never downgrade.
  let before = detect::installed_programs().unwrap_or_default();
  let installed = detect::find(&before, &config.detect);
  match detect::state(installed, config.version.as_deref()) {
    InstallState::UpToDate => {
      return result(app, ItemStatus::Skipped, format!("Already installed (version {}).", installed.and_then(|p| p.version.clone()).unwrap_or_default()));
    }
    InstallState::NewerInstalled => {
      return result(
        app,
        ItemStatus::Skipped,
        format!("A newer version ({}) is already installed.", installed.and_then(|p| p.version.clone()).unwrap_or_default()),
      );
    }
    _ => {}
  }
  let was_installed = installed.is_some();

  if let Some(free) = free_space(dir.parent().unwrap_or(dir)) {
    let needed = config.size_bytes.saturating_mul(2).saturating_add(SPACE_MARGIN);
    if free < needed {
      return result(app, ItemStatus::Failed, format!("Not enough free space on the system drive ({} free, about {} needed).", format_size(free), format_size(needed)));
    }
  }

  step(Step::Copying, format!("Copying {}…", config.installer));
  let staged = dir.join(&config.installer);
  if let Err(e) = fs::create_dir(dir).and_then(|_| fs::copy(&source, &staged)) {
    return result(app, ItemStatus::Failed, format!("Could not copy the installer from the application folder: {e}"));
  }

  step(Step::Verifying, "Checking the installer has not been changed…".into());
  let held = match lock(&staged) {
    Ok(file) => file,
    Err(e) => return result(app, ItemStatus::Failed, format!("Could not open the copied installer: {e}")),
  };
  match library::sha256(&held) {
    Ok(hash) if hash.eq_ignore_ascii_case(&config.sha256) => {}
    Ok(_) => {
      return result(app, ItemStatus::Failed, "The installer does not match the file that was set up, so it was not run. Set the app up again if you replaced it on purpose.");
    }
    Err(e) => return result(app, ItemStatus::Failed, format!("Could not read the copied installer: {e}")),
  }

  let (program, args) = command(config, &staged);
  let mut attempt = 0;
  let (code, outcome) = loop {
    step(Step::Installing, format!("Installing {}…", config.name));
    let code = match run_installer(&program, &args, dir, INSTALL_TIMEOUT) {
      Ok(RunOutcome::Exited(code)) => code,
      Ok(RunOutcome::StillRunning) => {
        return result(
          app,
          ItemStatus::StillRunning,
          format!("The installer was still running after {} minutes and was left to finish. Check it before installing anything else.", INSTALL_TIMEOUT.as_secs() / 60),
        );
      }
      Err(e) => return result(app, ItemStatus::Failed, e),
    };
    let outcome = classify(config.installer_type, code);
    if outcome != Outcome::Busy || attempt >= BUSY_RETRIES || center.cancel_requested() {
      break (code, outcome);
    }
    attempt += 1;
    step(Step::Waiting, "Another installation is running (often Windows Update). Waiting to try again…".into());
    std::thread::sleep(BUSY_WAIT);
  };
  drop(held);

  let mut item = match outcome {
    Outcome::Success { reboot } => {
      step(Step::Checking, "Confirming the app is installed…".into());
      verify(app, config, was_installed, reboot)
    }
    Outcome::Busy => result(app, ItemStatus::Failed, "Another installation kept running, so this app could not be installed. Try again later."),
    Outcome::Cancelled(message) => result(app, ItemStatus::Cancelled, message),
    Outcome::Failed(message) => result(app, ItemStatus::Failed, message),
    Outcome::NeedsRestart(message) => {
      let mut item = result(app, ItemStatus::Failed, message);
      item.reboot_required = true;
      item
    }
  };
  item.exit_code = Some(code);
  item
}

/// Success is only reported when Windows lists the app afterwards.
fn verify(app: &ScannedApp, config: &AppConfig, was_installed: bool, reboot: bool) -> ItemResult {
  let after: Vec<InstalledProgram> = detect::installed_programs().unwrap_or_default();
  let mut item = match detect::find(&after, &config.detect) {
    None => result(
      app,
      ItemStatus::Unverified,
      format!("The installer finished, but Windows does not list a program named \"{}\". Check Apps & features.", config.detect),
    ),
    Some(found) => {
      let behind = match (found.version.as_deref(), config.version.as_deref()) {
        (Some(have), Some(want)) => detect::compare_versions(have, want) == Some(std::cmp::Ordering::Less),
        _ => false,
      };
      if behind {
        let mut item = result(
          app,
          ItemStatus::Unverified,
          format!("The installer finished, but Windows still lists version {}.", found.version.clone().unwrap_or_default()),
        );
        item.version = found.version.clone();
        item
      } else {
        let status = if was_installed { ItemStatus::Updated } else { ItemStatus::Installed };
        let verb = if was_installed { "Updated" } else { "Installed" };
        let mut item = match &found.version {
          Some(v) => result(app, status, format!("{verb} — version {v}.")),
          None => result(app, status, format!("{verb}.")),
        };
        item.version = found.version.clone();
        item
      }
    }
  };
  if reboot {
    item.reboot_required = true;
    item.message.push_str(" Restart Windows to finish.");
  }
  item
}

#[cfg(test)]
mod tests {
  use super::*;

  fn config(installer_type: InstallerType, args: &[&str]) -> AppConfig {
    AppConfig {
      name: "Tool".into(),
      category: "Utilities".into(),
      description: String::new(),
      installer: "tool.exe".into(),
      installer_type,
      args: args.iter().map(|a| a.to_string()).collect(),
      sha256: "0".repeat(64),
      size_bytes: 1,
      version: None,
      publisher: None,
      detect: "Tool".into(),
    }
  }

  #[test]
  fn exit_codes_are_classified_per_technology() {
    assert_eq!(classify(InstallerType::Msi, 0), Outcome::Success { reboot: false });
    assert_eq!(classify(InstallerType::Msi, 3010), Outcome::Success { reboot: true });
    assert_eq!(classify(InstallerType::Burn, 1641), Outcome::Success { reboot: true });
    assert_eq!(classify(InstallerType::Msi, 1618), Outcome::Busy);
    assert!(matches!(classify(InstallerType::Msi, 1602), Outcome::Cancelled(_)));
    assert!(matches!(classify(InstallerType::Msi, 1603), Outcome::Failed(m) if m.contains("1603")));
    assert!(matches!(classify(InstallerType::Inno, 5), Outcome::Cancelled(_)));
    assert!(matches!(classify(InstallerType::Inno, 8), Outcome::NeedsRestart(_)));
    assert!(matches!(classify(InstallerType::Nsis, 2), Outcome::Failed(_)));
    // 1618 only means "busy" for Windows Installer technologies.
    assert!(matches!(classify(InstallerType::Custom, 1618), Outcome::Failed(_)));
  }

  #[test]
  fn silent_commands_use_fixed_switches() {
    let staged = Path::new(r"C:\ProgramData\VocaTechX\staging\run-1\0\tool.msi");
    let (program, args) = command(&config(InstallerType::Msi, &[]), staged);
    assert!(program.ends_with("msiexec.exe"));
    assert_eq!(args, ["/i", r"C:\ProgramData\VocaTechX\staging\run-1\0\tool.msi", "/qn", "/norestart"]);

    let staged = Path::new(r"C:\staging\tool.exe");
    assert_eq!(command(&config(InstallerType::Inno, &[]), staged).1, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"]);
    assert_eq!(command(&config(InstallerType::Nsis, &[]), staged).1, ["/S"]);
    assert_eq!(command(&config(InstallerType::Burn, &[]), staged).1, ["/quiet", "/norestart"]);
    let (program, args) = command(&config(InstallerType::Custom, &["--silent", "--no-launch"]), staged);
    assert_eq!(program, staged);
    assert_eq!(args, ["--silent", "--no-launch"]);
  }

  /// A locked installer can still be run (and read), but not replaced.
  #[cfg(windows)]
  #[test]
  fn locked_installer_runs_but_cannot_be_replaced() {
    let dir = tempfile::tempdir().unwrap();
    let exe = dir.path().join("fake-installer.exe");
    fs::copy(process::system32("cmd.exe"), &exe).unwrap();
    let held = lock(&exe).unwrap();

    assert!(fs::OpenOptions::new().write(true).open(&exe).is_err(), "writes are blocked");
    assert!(fs::remove_file(&exe).is_err(), "deletion is blocked");
    let args: Vec<String> = ["/c", "exit", "3010"].iter().map(|a| a.to_string()).collect();
    match run_installer(&exe, &args, dir.path(), Duration::from_secs(30)).unwrap() {
      RunOutcome::Exited(code) => assert_eq!(classify(InstallerType::Msi, code), Outcome::Success { reboot: true }),
      RunOutcome::StillRunning => panic!("should have exited"),
    }
    drop(held);
  }

  #[cfg(windows)]
  #[test]
  fn timeout_leaves_the_installer_running() {
    let dir = tempfile::tempdir().unwrap();
    let args: Vec<String> = ["-n", "3", "127.0.0.1"].iter().map(|a| a.to_string()).collect();
    let outcome = run_installer(&process::system32("ping.exe"), &args, dir.path(), Duration::from_millis(200)).unwrap();
    assert!(matches!(outcome, RunOutcome::StillRunning));
  }

  #[test]
  fn unknown_or_unready_apps_stop_the_batch_before_it_starts() {
    let dir = tempfile::tempdir().unwrap();
    let center = SoftwareCenter::new(dir.path().to_path_buf());
    assert!(resolve(&center, &[]).is_err());
    assert!(resolve(&center, &["vlc".into()]).is_err());

    let app = dir.path().join("vlc");
    fs::create_dir(&app).unwrap();
    fs::write(app.join("vlc.msi"), b"x").unwrap();
    fs::write(app.join(library::CONFIG_FILE), b"{ not json").unwrap();
    assert!(resolve(&center, &["vlc".into()]).unwrap_err().to_string().contains("cannot be installed"));
  }
}
