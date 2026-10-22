//! Uninstalls apps, one at a time, using what Windows itself recorded about
//! each program (the same entries Settings › Apps uses).
//!
//! The safest silent method available is chosen per program: the Windows
//! Installer product code (`msiexec /x`), else the program's own registered
//! silent command, else its uninstaller with that technology's standard silent
//! switch. Success is only reported once Windows no longer lists the program.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use super::detect::{self, InstalledProgram};
use super::install::{self, InstallEvent, ItemResult, ItemStatus, Outcome, RunOutcome, Step};
use super::library::{self, InstallerType, ScannedApp};
use super::SoftwareCenter;
use crate::error::{AppError, AppResult};
use crate::network::process;

const UNINSTALL_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Some uninstallers (NSIS) hand off to a copy of themselves and exit at once,
/// so the entry can take a while to disappear after the process ends.
const VANISH_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_BATCH: usize = 50;

/// A silent uninstall: the program to start, its arguments exactly as Windows
/// recorded them (passed through untouched), and how to read its exit code.
#[derive(Debug, PartialEq, Eq)]
struct UninstallCommand {
  program: PathBuf,
  args: String,
  kind: InstallerType,
}

/// `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`, the shape of an MSI product code.
fn is_product_code(value: &str) -> bool {
  let b = value.as_bytes();
  b.len() == 38
    && b[0] == b'{'
    && b[37] == b'}'
    && b[1..37].iter().enumerate().all(|(i, c)| if matches!(i, 8 | 13 | 18 | 23) { *c == b'-' } else { c.is_ascii_hexdigit() })
}

/// Splits a recorded command line into the program and the rest. Paths with
/// spaces are often recorded without quotes, so an unquoted program runs up to
/// the first `.exe`.
fn split_command_line(line: &str) -> Option<(String, String)> {
  let line = line.trim();
  if let Some(rest) = line.strip_prefix('"') {
    let end = rest.find('"')?;
    return Some((rest[..end].to_string(), rest[end + 1..].trim().to_string()));
  }
  let end = line.to_ascii_lowercase().find(".exe")? + 4;
  Some((line[..end].to_string(), line[end..].trim().to_string()))
}

fn file_name(path: &Path) -> String {
  path.file_name().map(|f| f.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()
}

/// Inno Setup names its uninstaller `unins000.exe` (`unins001.exe`, …).
/// NSIS's usual `uninstall.exe` must not match.
fn is_inno_uninstaller(name: &str) -> bool {
  name
    .strip_prefix("unins")
    .and_then(|rest| rest.strip_suffix(".exe"))
    .is_some_and(|digits| !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()))
}

/// The program as an absolute path to an existing file. Only msiexec may be
/// given by bare name, and it is always taken from System32.
fn resolve_program(program: &str) -> Result<PathBuf, String> {
  let path = PathBuf::from(program.trim());
  if file_name(&path) == "msiexec.exe" {
    return Ok(process::system32("msiexec.exe"));
  }
  if !path.is_absolute() || !path.is_file() {
    return Err(format!("Its uninstaller ({}) is missing. Remove it from Settings › Apps instead.", path.display()));
  }
  Ok(path)
}

fn product_code(program: &InstalledProgram) -> Option<String> {
  if let Some(name) = program.key_name.as_deref().filter(|n| is_product_code(n))
    && (program.windows_installer || program.uninstall.as_deref().is_some_and(|u| u.to_ascii_lowercase().contains("msiexec")))
  {
    return Some(name.to_string());
  }
  // `MsiExec.exe /X{…}` or `/I{…}` recorded against a non-GUID key.
  let line = program.uninstall.as_deref()?;
  if !line.to_ascii_lowercase().contains("msiexec") {
    return None;
  }
  let start = line.find('{')?;
  let code = line.get(start..start + 38)?;
  is_product_code(code).then(|| code.to_string())
}

/// Works out how to remove `program` silently. `fallback` is the installer
/// type from the app's `app.json`, used when the uninstaller itself gives no clue.
fn uninstall_command(program: &InstalledProgram, fallback: InstallerType) -> Result<UninstallCommand, String> {
  if let Some(code) = product_code(program) {
    return Ok(UninstallCommand {
      program: process::system32("msiexec.exe"),
      args: format!("/x {code} /qn /norestart"),
      kind: InstallerType::Msi,
    });
  }

  if let Some((exe, args)) = program.quiet_uninstall.as_deref().filter(|q| !q.trim().is_empty()).and_then(split_command_line) {
    let program = resolve_program(&exe)?;
    let kind = if file_name(&program) == "msiexec.exe" { InstallerType::Msi } else { fallback_kind(&program, fallback) };
    return Ok(UninstallCommand { program, args, kind });
  }

  let line = program.uninstall.as_deref().filter(|u| !u.trim().is_empty()).ok_or("Windows has no uninstall command for it.")?;
  let (exe, args) = split_command_line(line).ok_or("Windows' uninstall command for it could not be read.")?;
  let program = resolve_program(&exe)?;
  let name = file_name(&program);
  let join = |extra: &str| if args.is_empty() { extra.to_string() } else { format!("{args} {extra}") };

  let (args, kind) = if is_inno_uninstaller(&name) {
    (join("/VERYSILENT /SUPPRESSMSGBOXES /NORESTART"), InstallerType::Inno)
  } else if args.contains("--uninstall") {
    // Chromium-based browsers (Chrome, Edge…): their setup.exe asks for
    // confirmation unless told to force the uninstall.
    (join("--force-uninstall"), InstallerType::Custom)
  } else if matches!(name.as_str(), "uninstall.exe" | "uninst.exe") {
    (join("/S"), InstallerType::Nsis)
  } else {
    match fallback {
      InstallerType::Inno => (join("/VERYSILENT /SUPPRESSMSGBOXES /NORESTART"), InstallerType::Inno),
      InstallerType::Nsis => (join("/S"), InstallerType::Nsis),
      InstallerType::Burn => (join("/quiet /norestart"), InstallerType::Burn),
      InstallerType::Msi | InstallerType::Custom => {
        return Err("It has no silent uninstall that VocaTechX recognises. Remove it from Settings › Apps instead.".into());
      }
    }
  };
  Ok(UninstallCommand { program, args, kind })
}

fn fallback_kind(program: &Path, fallback: InstallerType) -> InstallerType {
  let name = file_name(program);
  if is_inno_uninstaller(&name) {
    InstallerType::Inno
  } else if matches!(name.as_str(), "uninstall.exe" | "uninst.exe") {
    InstallerType::Nsis
  } else if fallback == InstallerType::Msi {
    InstallerType::Custom
  } else {
    fallback
  }
}

/// When a program matches more than one entry, the Windows Installer one is
/// preferred: `msiexec /x` is the cleanest silent removal.
fn pick<'a>(programs: &'a [InstalledProgram], detect: &str) -> Option<&'a InstalledProgram> {
  let best = detect::find(programs, detect)?;
  Some(
    programs
      .iter()
      .find(|p| p.name.eq_ignore_ascii_case(&best.name) && product_code(p).is_some())
      .unwrap_or(best),
  )
}

fn resolve(center: &SoftwareCenter, ids: &[String]) -> AppResult<Vec<ScannedApp>> {
  if ids.is_empty() {
    return Err(AppError::validation("Select at least one app to uninstall."));
  }
  if ids.len() > MAX_BATCH {
    return Err(AppError::validation(format!("Uninstall at most {MAX_BATCH} apps at a time.")));
  }
  let scan = library::scan(center.folder());
  let mut apps: Vec<ScannedApp> = Vec::new();
  for id in ids {
    if apps.iter().any(|a| &a.id == id) {
      continue;
    }
    // The installer may be missing or changed; uninstalling only needs app.json.
    let app = scan
      .apps
      .iter()
      .find(|a| &a.id == id && a.config.is_some())
      .ok_or_else(|| AppError::validation("One of the selected apps is no longer in the application folder. Refresh the list."))?;
    apps.push(app.clone());
  }
  Ok(apps)
}

/// Uninstalls the apps one at a time, reporting each step through `emit`.
pub fn run_batch(center: &SoftwareCenter, ids: &[String], emit: &dyn Fn(InstallEvent)) -> AppResult<Vec<ItemResult>> {
  if !crate::network::sys::is_elevated() {
    return Err(AppError::Software("Uninstalling apps needs administrator rights. Start VocaTechX as administrator.".into()));
  }
  let _guard = center.begin_install().ok_or_else(|| AppError::Software("Another install or uninstall is already running.".into()))?;
  let apps = resolve(center, ids)?;

  let mut results = Vec::with_capacity(apps.len());
  let mut stop_reason: Option<String> = None;
  for (index, app) in apps.iter().enumerate() {
    let item = if let Some(reason) = &stop_reason {
      install::result(app, ItemStatus::Cancelled, reason.clone())
    } else if center.cancel_requested() {
      install::result(app, ItemStatus::Cancelled, "Not started: the uninstall was stopped.")
    } else {
      uninstall_one(app, &|step, message| emit(InstallEvent::Step { index, step, message }))
    };
    if item.status == ItemStatus::StillRunning {
      stop_reason = Some(format!("Not started: {} was still uninstalling.", item.name));
    }
    emit(InstallEvent::Finished { index, result: item.clone() });
    results.push(item);
  }
  Ok(results)
}

fn uninstall_one(app: &ScannedApp, step: &dyn Fn(Step, String)) -> ItemResult {
  let config = app.config.as_ref().expect("resolve() only returns apps with app.json");
  step(Step::Checking, "Finding it in Windows' installed apps…".into());
  let programs = match detect::installed_programs() {
    Ok(programs) => programs,
    Err(e) => return install::result(app, ItemStatus::Failed, e),
  };
  let Some(program) = pick(&programs, &config.detect) else {
    return install::result(app, ItemStatus::Skipped, "It is not installed.");
  };
  let command = match uninstall_command(program, config.installer_type) {
    Ok(command) => command,
    Err(e) => return install::result(app, ItemStatus::Failed, e),
  };

  step(Step::Uninstalling, format!("Uninstalling {}…", program.name));
  let mut process = Command::new(&command.program);
  #[cfg(windows)]
  {
    // Passed exactly as Windows recorded it; never through a shell.
    use std::os::windows::process::CommandExt;
    process.raw_arg(&command.args);
  }
  if let Some(dir) = command.program.parent() {
    process.current_dir(dir);
  }
  let code = match install::wait(process, UNINSTALL_TIMEOUT) {
    Ok(RunOutcome::Exited(code)) => code,
    Ok(RunOutcome::StillRunning) => {
      return install::result(
        app,
        ItemStatus::StillRunning,
        format!("The uninstaller was still running after {} minutes and was left to finish.", UNINSTALL_TIMEOUT.as_secs() / 60),
      );
    }
    Err(e) => return install::result(app, ItemStatus::Failed, format!("The uninstaller could not start: {e}")),
  };

  // Uninstallers without documented exit codes (Chromium's setup.exe) are
  // judged only by whether Windows stops listing the program.
  let outcome = if command.kind == InstallerType::Custom { Outcome::Success { reboot: false } } else { install::classify(command.kind, code) };
  let mut item = match outcome {
    Outcome::Success { reboot } => {
      step(Step::Checking, "Confirming it was removed…".into());
      let mut item = if wait_until_gone(&program.key) {
        install::result(app, ItemStatus::Uninstalled, "Uninstalled.")
      } else {
        install::result(app, ItemStatus::Unverified, format!("The uninstaller finished, but Windows still lists \"{}\". Check Settings › Apps.", program.name))
      };
      if reboot {
        item.reboot_required = true;
        item.message.push_str(" Restart Windows to finish.");
      }
      item
    }
    Outcome::Busy => install::result(app, ItemStatus::Failed, "Another installation is running (often Windows Update). Try again later."),
    Outcome::Cancelled(_) => install::result(app, ItemStatus::Cancelled, "The uninstall was cancelled."),
    Outcome::Failed(message) => install::result(app, ItemStatus::Failed, message.replace("installer", "uninstaller")),
    Outcome::NeedsRestart(message) => {
      let mut item = install::result(app, ItemStatus::Failed, message);
      item.reboot_required = true;
      item
    }
  };
  item.exit_code = Some(code);
  item
}

/// Waits for the program's registry entry to disappear.
fn wait_until_gone(key: &str) -> bool {
  let started = Instant::now();
  loop {
    match detect::installed_programs() {
      Ok(programs) if !programs.iter().any(|p| p.key == key) => return true,
      _ if started.elapsed() >= VANISH_TIMEOUT => return false,
      _ => std::thread::sleep(Duration::from_secs(3)),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn entry(key_name: &str, uninstall: &str, quiet: &str) -> InstalledProgram {
    InstalledProgram {
      name: "App".into(),
      key: format!(r"Registry::HKEY_LOCAL_MACHINE\...\Uninstall\{key_name}"),
      key_name: Some(key_name.into()),
      uninstall: Some(uninstall.into()),
      quiet_uninstall: (!quiet.is_empty()).then(|| quiet.into()),
      ..Default::default()
    }
  }

  #[test]
  fn recognises_product_codes() {
    assert!(is_product_code("{23170F69-40C1-2702-2600-000001000000}"));
    assert!(!is_product_code("{23170F69-40C1-2702-2600-00000100000}"));
    assert!(!is_product_code("Notepad++"));
    assert!(!is_product_code("{23170F69-40C1-2702-2600-00000100000Z}"));
  }

  #[test]
  fn tells_inno_uninstallers_from_nsis_ones() {
    assert!(is_inno_uninstaller("unins000.exe"));
    assert!(is_inno_uninstaller("unins012.exe"));
    assert!(!is_inno_uninstaller("uninstall.exe"));
    assert!(!is_inno_uninstaller("unins.exe"));
  }

  #[test]
  fn splits_quoted_and_unquoted_command_lines() {
    assert_eq!(
      split_command_line(r#""C:\Program Files\Git\unins000.exe" /SILENT"#),
      Some((r"C:\Program Files\Git\unins000.exe".into(), "/SILENT".into()))
    );
    assert_eq!(
      split_command_line(r"C:\Program Files (x86)\Tool\uninst.exe /x"),
      Some((r"C:\Program Files (x86)\Tool\uninst.exe".into(), "/x".into()))
    );
    assert_eq!(split_command_line("no program here"), None);
  }

  #[test]
  fn msi_entries_use_msiexec_with_the_product_code() {
    let code = "{23170F69-40C1-2702-2600-000001000000}";
    let mut msi = entry(code, &format!("MsiExec.exe /I{code}"), "");
    msi.windows_installer = true;
    let command = uninstall_command(&msi, InstallerType::Nsis).unwrap();
    assert!(command.program.ends_with("msiexec.exe"));
    assert_eq!(command.args, format!("/x {code} /qn /norestart"));
    assert_eq!(command.kind, InstallerType::Msi);

    // A crafted product code is never passed to msiexec.
    let bad = entry("Tool", "MsiExec.exe /X{bad} & calc", "");
    assert!(product_code(&bad).is_none());
  }

  /// Uses real uninstaller paths that exist on every Windows install, so only
  /// the switch selection is under test.
  #[cfg(windows)]
  #[test]
  fn picks_silent_switches_for_exe_uninstallers() {
    let dir = tempfile::tempdir().unwrap();
    let make = |name: &str| {
      let path = dir.path().join(name);
      std::fs::write(&path, b"MZ").unwrap();
      path.to_string_lossy().into_owned()
    };

    let inno = make("unins000.exe");
    let command = uninstall_command(&entry("Git_is1", &format!("\"{inno}\""), ""), InstallerType::Custom).unwrap();
    assert_eq!(command.args, "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART");
    assert_eq!(command.kind, InstallerType::Inno);

    let nsis = make("uninstall.exe");
    let command = uninstall_command(&entry("VLC media player", &format!("\"{nsis}\""), ""), InstallerType::Msi).unwrap();
    assert_eq!(command.args, "/S");

    let quiet = uninstall_command(&entry("Notepad++", &format!("\"{nsis}\""), &format!("\"{nsis}\" /S")), InstallerType::Custom).unwrap();
    assert_eq!(quiet.args, "/S");
    assert_eq!(quiet.kind, InstallerType::Nsis);

    let chrome = make("setup.exe");
    let command =
      uninstall_command(&entry("Google Chrome", &format!("\"{chrome}\" --uninstall --channel=stable --system-level"), ""), InstallerType::Msi).unwrap();
    assert_eq!(command.args, "--uninstall --channel=stable --system-level --force-uninstall");

    let other = make("remove-tool.exe");
    assert!(uninstall_command(&entry("Tool", &format!("\"{other}\""), ""), InstallerType::Custom).is_err());
    assert!(uninstall_command(&entry("Tool", r#""C:\does\not\exist\uninstall.exe""#, ""), InstallerType::Nsis).is_err());
  }

  /// Prints the command that would remove a few real programs. Nothing runs.
  /// `cargo test software_uninstall_plan_live -- --ignored --nocapture`
  #[test]
  #[ignore]
  fn software_uninstall_plan_live() {
    let programs = detect::installed_programs().unwrap();
    for name in ["Notepad++", "VLC media player", "Git", "Google Chrome", "7-Zip"] {
      match pick(&programs, name) {
        None => println!("{name}: not installed"),
        Some(p) => println!("{name}: {:?}", uninstall_command(p, InstallerType::Custom)),
      }
    }
  }

  #[test]
  fn prefers_the_windows_installer_entry() {
    let code = "{23170F69-40C1-2702-2600-000001000000}";
    let exe = InstalledProgram { name: "7-Zip".into(), version: Some("26.05".into()), key_name: Some("7-Zip".into()), ..Default::default() };
    let msi = InstalledProgram {
      name: "7-Zip".into(),
      version: Some("26.05".into()),
      key_name: Some(code.into()),
      windows_installer: true,
      ..Default::default()
    };
    let programs = [exe, msi];
    assert_eq!(pick(&programs, "7-Zip").unwrap().key_name.as_deref(), Some(code));
  }
}
