//! Windows Repair: the built-in Windows repair tools (DISM, SFC, CHKDSK,
//! Memory Diagnostic, Windows Update reset, restore points, recovery options
//! and cleanup), run one at a time with live progress.
//!
//! Every repair runs a real Windows tool with fixed arguments and judges the
//! result from what the tool reported, never from "it ran". Nothing restarts
//! the computer on its own (except "Restart to Advanced Startup", which the
//! user confirms) and no program is force-closed.

pub mod cleanup;
pub mod status;
pub mod stream;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use crate::network::process;
use stream::Finished;

/// History entries are recorded under this operation type.
pub const OPERATION_TYPE: &str = "windows_repair";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RepairId {
  DismRestore,
  Sfc,
  ChkdskScan,
  MemoryTest,
  WuReset,
  WuCache,
  WuServices,
  RestorePoint,
  SystemRestore,
  AdvancedStartup,
  SafeMode,
  SafeModeOff,
  TempFiles,
  OptimizeDrives,
  IconCache,
  StoreCache,
  FullRepair,
}

impl RepairId {
  /// Also the history entry's title, which the status cards look up.
  pub fn title(self) -> &'static str {
    match self {
      Self::DismRestore => "Repair the Windows image",
      Self::Sfc => "Scan and repair system files",
      Self::ChkdskScan => "Check the disk for errors",
      Self::MemoryTest => "Test the memory",
      Self::WuReset => "Reset Windows Update components",
      Self::WuCache => "Clear the update download cache",
      Self::WuServices => "Restart the update services",
      Self::RestorePoint => "Create a restore point",
      Self::SystemRestore => "Open System Restore",
      Self::AdvancedStartup => "Restart to Advanced Startup",
      Self::SafeMode => "Start in Safe Mode next time",
      Self::SafeModeOff => "Return to normal startup",
      Self::TempFiles => "Clear temporary files",
      Self::OptimizeDrives => "Optimise drives",
      Self::IconCache => "Rebuild the icon cache",
      Self::StoreCache => "Reset the Microsoft Store cache",
      Self::FullRepair => "Full system repair",
    }
  }
}

impl RepairId {
  /// The icon and Store refreshes work for the signed-in user; everything else
  /// changes the system and needs VocaTechX to run as administrator.
  pub fn needs_admin(self) -> bool {
    !matches!(self, Self::IconCache | Self::StoreCache)
  }
}

/// The steps of a full repair, least to most involved.
pub const FULL_REPAIR_STEPS: [RepairId; 4] = [RepairId::RestorePoint, RepairId::DismRestore, RepairId::Sfc, RepairId::ChkdskScan];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
  /// Ran and found nothing wrong (or did what it does).
  Success,
  /// Found problems and fixed them.
  Repaired,
  /// Found problems it could not fully fix, or did not do what was asked.
  Issues,
  Failed,
  /// Set up to happen at the next restart.
  Scheduled,
  /// Opened a Windows tool or started a restart.
  Started,
  /// Still running after the time limit; left to finish.
  StillRunning,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairResult {
  pub repair: RepairId,
  pub title: &'static str,
  pub outcome: Outcome,
  pub summary: String,
  /// The tool's own output (progress lines left out), for the log and report.
  pub details: Vec<String>,
  pub restart_recommended: bool,
  /// For a full repair: each step's result.
  pub steps: Vec<RepairResult>,
}

impl RepairResult {
  fn new(repair: RepairId, outcome: Outcome, summary: impl Into<String>) -> Self {
    Self { repair, title: repair.title(), outcome, summary: summary.into(), details: Vec::new(), restart_recommended: false, steps: Vec::new() }
  }
  fn details(mut self, details: Vec<String>) -> Self {
    self.details = details;
    self
  }
  fn restart(mut self) -> Self {
    self.restart_recommended = true;
    self
  }
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RepairEvent {
  /// A full repair moved to its next step.
  Step { index: usize, total: usize, title: String },
  /// The tool reported how far it is (0–100).
  Progress { percent: f32 },
  /// A line of the tool's output.
  Line { text: String },
}

/// Only one repair runs at a time.
#[derive(Default)]
pub struct RepairGuard(AtomicBool);

impl RepairGuard {
  pub fn begin(&self) -> Option<RepairLock<'_>> {
    self.0.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).ok().map(|_| RepairLock(self))
  }
  pub fn running(&self) -> bool {
    self.0.load(Ordering::SeqCst)
  }
}

pub struct RepairLock<'a>(&'a RepairGuard);

impl Drop for RepairLock<'_> {
  fn drop(&mut self) {
    self.0 .0.store(false, Ordering::SeqCst);
  }
}

const LONG: Duration = Duration::from_secs(2 * 60 * 60);
const SHORT: Duration = Duration::from_secs(5 * 60);

fn system32(exe: &str) -> PathBuf {
  process::system32(exe)
}

/// The Windows drive, e.g. `C:`. Checked so only a plain drive letter is passed on.
pub fn system_drive() -> String {
  let drive = std::env::var("SystemDrive").unwrap_or_default();
  let ok = drive.len() == 2 && drive.as_bytes()[0].is_ascii_alphabetic() && drive.as_bytes()[1] == b':';
  if ok { drive.to_ascii_uppercase() } else { "C:".into() }
}

/// Progress bars and percentage lines are shown live but left out of the log.
fn is_progress(line: &str) -> bool {
  stream::percent(line).is_some() && (line.contains('[') || line.to_ascii_lowercase().contains("complete"))
}

/// A tool that did not run to completion.
enum ToolError {
  /// Windows could not start it.
  Start(String),
  /// Still running after the time limit, with the output so far.
  StillRunning { output: Vec<String>, message: String },
}

/// Runs a tool, forwarding its lines and progress. Returns the exit code and
/// the output without progress lines.
fn run_tool(program: &str, args: &[&str], timeout: Duration, emit: &dyn Fn(RepairEvent)) -> Result<(Option<i32>, Vec<String>), ToolError> {
  let mut forward = |line: &str| match stream::percent(line).filter(|_| is_progress(line)) {
    Some(p) => emit(RepairEvent::Progress { percent: p }),
    None => emit(RepairEvent::Line { text: line.to_string() }),
  };
  let keep = |output: Vec<String>| output.into_iter().filter(|l| !is_progress(l)).collect::<Vec<_>>();
  match stream::run(&system32(program), args, timeout, &mut forward) {
    Ok(Finished::Exited { code, output }) => Ok((code, keep(output))),
    Ok(Finished::StillRunning { output }) => Err(ToolError::StillRunning {
      output: keep(output),
      message: format!("{program} was still running after {} minutes and was left to finish. Check it in Task Manager.", timeout.as_secs() / 60),
    }),
    Err(e) => Err(ToolError::Start(e)),
  }
}

fn still_running(repair: RepairId, error: ToolError) -> RepairResult {
  match error {
    ToolError::Start(message) => RepairResult::new(repair, Outcome::Failed, message),
    ToolError::StillRunning { output, message } => RepairResult::new(repair, Outcome::StillRunning, message).details(output),
  }
}

fn has(output: &[String], needle: &str) -> bool {
  let needle = needle.to_ascii_lowercase();
  output.iter().any(|l| l.to_ascii_lowercase().contains(&needle))
}

fn first_error(output: &[String]) -> Option<String> {
  output.iter().find(|l| l.to_ascii_lowercase().starts_with("error")).cloned()
}

// ---------------------------------------------------------------------------
// Result interpretation (pure, so it is unit-tested with real tool messages)

pub fn judge_dism(code: Option<i32>, output: &[String]) -> (Outcome, String, bool) {
  if code == Some(0) {
    if has(output, "corruption was repaired") {
      (Outcome::Repaired, "Damage in the Windows component store was found and repaired. Run \"Scan and repair system files\" next.".into(), false)
    } else {
      (Outcome::Success, "The Windows component store is healthy.".into(), false)
    }
  } else if has(output, "0x800f081f") || has(output, "source files could not be found") {
    (
      Outcome::Failed,
      "DISM could not find the files it needs (0x800f081f). Check the internet connection and Windows Update, or repair from Windows installation media.".into(),
      false,
    )
  } else if has(output, "restart") && has(output, "pending") {
    (Outcome::Issues, "A restart is pending. Restart Windows, then run this repair again.".into(), true)
  } else {
    (Outcome::Failed, first_error(output).unwrap_or_else(|| format!("DISM did not finish (exit code {}).", code.unwrap_or(-1))), false)
  }
}

pub fn judge_sfc(code: Option<i32>, output: &[String]) -> (Outcome, String, bool) {
  if has(output, "did not find any integrity violations") {
    (Outcome::Success, "No damaged system files were found.".into(), false)
  } else if has(output, "successfully repaired") {
    (Outcome::Repaired, "Damaged system files were found and repaired. Restart Windows to finish.".into(), true)
  } else if has(output, "unable to fix some") {
    (
      Outcome::Issues,
      "Some damaged files could not be repaired. Run \"Repair the Windows image\" (DISM), restart, then run this scan again.".into(),
      false,
    )
  } else if has(output, "repair pending") || has(output, "pending reboot") {
    (Outcome::Issues, "A system repair is waiting for a restart. Restart Windows, then run the scan again.".into(), true)
  } else if has(output, "could not perform the requested operation") {
    (Outcome::Failed, "SFC could not run. Restart Windows, or run it from Safe Mode.".into(), false)
  } else if code == Some(0) {
    (Outcome::Success, "The system file scan finished.".into(), false)
  } else {
    (Outcome::Failed, format!("The system file scan did not finish (exit code {}).", code.unwrap_or(-1)), false)
  }
}

pub fn judge_chkdsk(code: Option<i32>, output: &[String]) -> (Outcome, String, bool) {
  if has(output, "found no problems") {
    (Outcome::Success, "No file system errors were found.".into(), false)
  } else if has(output, "spotfix") || has(output, "found problems") || has(output, "must be fixed offline") {
    (
      Outcome::Issues,
      "File system problems were found that must be fixed offline. Back up first, then run \"chkdsk /spotfix\" or restart to let Windows repair the disk.".into(),
      true,
    )
  } else if code == Some(0) {
    (Outcome::Success, "The disk check finished without errors.".into(), false)
  } else {
    (Outcome::Failed, first_error(output).unwrap_or_else(|| format!("The disk check did not finish (exit code {}).", code.unwrap_or(-1))), false)
  }
}

// ---------------------------------------------------------------------------
// The repairs

fn dism(emit: &dyn Fn(RepairEvent)) -> RepairResult {
  let id = RepairId::DismRestore;
  match run_tool("Dism.exe", &["/Online", "/Cleanup-Image", "/RestoreHealth"], LONG, emit) {
    Ok((code, output)) => {
      let (outcome, summary, restart) = judge_dism(code, &output);
      let r = RepairResult::new(id, outcome, summary).details(output);
      if restart { r.restart() } else { r }
    }
    Err(e) => still_running(id, e),
  }
}

fn sfc(emit: &dyn Fn(RepairEvent)) -> RepairResult {
  let id = RepairId::Sfc;
  match run_tool("sfc.exe", &["/scannow"], LONG, emit) {
    Ok((code, output)) => {
      let (outcome, summary, restart) = judge_sfc(code, &output);
      let r = RepairResult::new(id, outcome, summary).details(output);
      if restart { r.restart() } else { r }
    }
    Err(e) => still_running(id, e),
  }
}

fn chkdsk(emit: &dyn Fn(RepairEvent)) -> RepairResult {
  let id = RepairId::ChkdskScan;
  let drive = system_drive();
  match run_tool("chkdsk.exe", &[&drive, "/scan"], LONG, emit) {
    Ok((code, output)) => {
      let (outcome, summary, restart) = judge_chkdsk(code, &output);
      let r = RepairResult::new(id, outcome, format!("{drive} {summary}")).details(output);
      if restart { r.restart() } else { r }
    }
    Err(e) => still_running(id, e),
  }
}

fn bcdedit(id: RepairId, args: &[&str], emit: &dyn Fn(RepairEvent)) -> Result<Vec<String>, RepairResult> {
  match run_tool("bcdedit.exe", args, SHORT, emit) {
    Ok((Some(0), output)) => Ok(output),
    Ok((code, output)) => Err(RepairResult::new(id, Outcome::Failed, first_error(&output).unwrap_or_else(|| format!("bcdedit failed (exit code {}).", code.unwrap_or(-1)))).details(output)),
    Err(e) => Err(still_running(id, e)),
  }
}

fn memory_test(emit: &dyn Fn(RepairEvent)) -> RepairResult {
  let id = RepairId::MemoryTest;
  match bcdedit(id, &["/bootsequence", "{memdiag}"], emit) {
    Ok(output) => RepairResult::new(
      id,
      Outcome::Scheduled,
      "Windows Memory Diagnostic will run at the next restart, before Windows starts. Restart when you are ready; the result is shown after you sign in, and on this page.",
    )
    .details(output)
    .restart(),
    Err(r) => r,
  }
}

fn safe_mode(on: bool, emit: &dyn Fn(RepairEvent)) -> RepairResult {
  if on {
    let id = RepairId::SafeMode;
    match bcdedit(id, &["/set", "{current}", "safeboot", "minimal"], emit) {
      Ok(output) => RepairResult::new(
        id,
        Outcome::Scheduled,
        "Windows will start in Safe Mode every time until you switch back. After fixing the problem, open VocaTechX and choose \"Return to normal startup\" (or use msconfig → Boot).",
      )
      .details(output)
      .restart(),
      Err(r) => r,
    }
  } else {
    let id = RepairId::SafeModeOff;
    match run_tool("bcdedit.exe", &["/deletevalue", "{current}", "safeboot"], SHORT, emit) {
      Ok((Some(0), output)) => RepairResult::new(id, Outcome::Success, "Windows will start normally at the next restart.").details(output),
      // Nothing to remove: it was not set.
      Ok((_, output)) if has(&output, "not found") => RepairResult::new(id, Outcome::Success, "Safe Mode was not set; Windows already starts normally.").details(output),
      Ok((code, output)) => RepairResult::new(id, Outcome::Failed, first_error(&output).unwrap_or_else(|| format!("bcdedit failed (exit code {}).", code.unwrap_or(-1)))).details(output),
      Err(e) => still_running(id, e),
    }
  }
}

/// Runs a fixed PowerShell script (no user input is ever placed in it) and
/// forwards its output lines.
fn powershell_repair(script: &str, emit: &dyn Fn(RepairEvent)) -> (Option<i32>, Vec<String>) {
  match process::powershell(script, SHORT) {
    Ok(out) => {
      let lines: Vec<String> = stream::lines(&out.text()).map(str::to_string).collect();
      for l in &lines {
        emit(RepairEvent::Line { text: l.clone() });
      }
      (out.code, lines)
    }
    Err(e) => {
      emit(RepairEvent::Line { text: e.clone() });
      (None, vec![e])
    }
  }
}

const UPDATE_SERVICES: &str = "'wuauserv','bits','cryptsvc'";

fn wu_reset(emit: &dyn Fn(RepairEvent)) -> RepairResult {
  let id = RepairId::WuReset;
  let script = format!(
    r#"$ErrorActionPreference = 'Stop'
$services = {UPDATE_SERVICES}
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$failed = $false
try {{
  foreach ($s in $services) {{ Stop-Service -Name $s -Force; "Stopped $s" }}
  $sd = Join-Path $env:SystemRoot 'SoftwareDistribution'
  if (Test-Path -LiteralPath $sd) {{ Rename-Item -LiteralPath $sd -NewName "SoftwareDistribution.vtx-$stamp"; "Renamed SoftwareDistribution to SoftwareDistribution.vtx-$stamp" }}
  $cr = Join-Path $env:SystemRoot 'System32\catroot2'
  if (Test-Path -LiteralPath $cr) {{ Rename-Item -LiteralPath $cr -NewName "catroot2.vtx-$stamp"; "Renamed catroot2 to catroot2.vtx-$stamp" }}
}} catch {{
  "ERROR: $($_.Exception.Message)"; $failed = $true
}} finally {{
  foreach ($s in $services) {{
    try {{ Start-Service -Name $s; "Started $s" }} catch {{ "ERROR: could not start ${{s}}: $($_.Exception.Message)"; $failed = $true }}
  }}
}}
if ($failed) {{ exit 1 }}"#
  );
  let (code, output) = powershell_repair(&script, emit);
  if code == Some(0) {
    RepairResult::new(
      id,
      Outcome::Success,
      "Windows Update components were reset. Run Windows Update again; the first check can take longer while Windows rebuilds its files. The old folders were kept with a .vtx- name and can be deleted later.",
    )
    .details(output)
  } else {
    RepairResult::new(id, Outcome::Failed, first_error(&output).map(|e| e.trim_start_matches("ERROR: ").to_string()).unwrap_or_else(|| "The reset did not complete.".into()))
      .details(output)
  }
}

fn wu_cache(emit: &dyn Fn(RepairEvent)) -> RepairResult {
  let id = RepairId::WuCache;
  let (code, mut output) = powershell_repair("Stop-Service -Name 'wuauserv','bits' -Force -ErrorAction Stop; 'Stopped wuauserv and bits'", emit);
  if code != Some(0) {
    let _ = powershell_repair("Start-Service -Name 'bits','wuauserv'", emit);
    return RepairResult::new(id, Outcome::Failed, "The update services could not be stopped, so the cache was left alone.").details(output);
  }
  let download = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into())).join("SoftwareDistribution").join("Download");
  let mut cleaned = cleanup::CleanupResult::default();
  cleanup::clean(&download, SystemTime::now(), Duration::ZERO, &mut cleaned);
  let line = format!("Removed {} files ({})", cleaned.files_removed, format_bytes(cleaned.bytes_freed));
  emit(RepairEvent::Line { text: line.clone() });
  output.push(line);
  let (start_code, start_output) = powershell_repair("Start-Service -Name 'bits','wuauserv' -ErrorAction Stop; 'Started bits and wuauserv'", emit);
  output.extend(start_output);
  let outcome = if start_code == Some(0) { Outcome::Success } else { Outcome::Issues };
  RepairResult::new(id, outcome, format!("Cleared {} of downloaded updates. Windows downloads what it still needs on the next check.", format_bytes(cleaned.bytes_freed))).details(output)
}

fn wu_services(emit: &dyn Fn(RepairEvent)) -> RepairResult {
  let id = RepairId::WuServices;
  let script = format!(
    "$ErrorActionPreference = 'Stop'; foreach ($s in {UPDATE_SERVICES}) {{ Restart-Service -Name $s -Force; \"Restarted ${{s}}: $((Get-Service $s).Status)\" }}"
  );
  let (code, output) = powershell_repair(&script, emit);
  if code == Some(0) {
    RepairResult::new(id, Outcome::Success, "Windows Update, BITS and Cryptographic services were restarted.").details(output)
  } else {
    RepairResult::new(id, Outcome::Failed, "One or more update services could not be restarted.").details(output)
  }
}

fn restore_point(emit: &dyn Fn(RepairEvent)) -> RepairResult {
  let id = RepairId::RestorePoint;
  let script = r#"function Last { Get-ComputerRestorePoint -ErrorAction SilentlyContinue | Sort-Object SequenceNumber | Select-Object -Last 1 }
$before = Last
try {
  Checkpoint-Computer -Description 'VocaTechX restore point' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop -WarningVariable w -WarningAction SilentlyContinue
} catch { "ERROR: $($_.Exception.Message)"; exit 2 }
$after = Last
if ($after -and (-not $before -or $after.SequenceNumber -ne $before.SequenceNumber)) { "Created restore point $($after.SequenceNumber)"; exit 0 }
if ($w) { "WARNING: $w" }
exit 3"#;
  let (code, output) = powershell_repair(script, emit);
  match code {
    Some(0) => RepairResult::new(id, Outcome::Success, "A restore point was created. You can return to it with System Restore.").details(output),
    Some(3) => RepairResult::new(
      id,
      Outcome::Issues,
      "Windows did not create a new restore point: by default it allows one every 24 hours. The most recent one can still be used with System Restore.",
    )
    .details(output),
    _ if has(&output, "disabled") || has(&output, "turned off") => RepairResult::new(
      id,
      Outcome::Failed,
      "System Protection is turned off for the Windows drive. Turn it on in System Properties → System Protection → Configure, then try again.",
    )
    .details(output),
    _ => RepairResult::new(id, Outcome::Failed, first_error(&output).map(|e| e.trim_start_matches("ERROR: ").to_string()).unwrap_or_else(|| "The restore point could not be created.".into()))
      .details(output),
  }
}

fn launch(id: RepairId, exe: &str, summary: &str) -> RepairResult {
  match process::launch(&system32(exe), &[]) {
    Ok(()) => RepairResult::new(id, Outcome::Started, summary),
    Err(e) => RepairResult::new(id, Outcome::Failed, e),
  }
}

fn advanced_startup(emit: &dyn Fn(RepairEvent)) -> RepairResult {
  let id = RepairId::AdvancedStartup;
  // No /f: Windows asks running programs to close normally.
  match run_tool("shutdown.exe", &["/r", "/o", "/t", "0"], SHORT, emit) {
    Ok((Some(0), output)) => RepairResult::new(id, Outcome::Started, "Windows is restarting into Advanced Startup. Choose Troubleshoot → Advanced options.").details(output),
    Ok((code, output)) => RepairResult::new(id, Outcome::Failed, first_error(&output).unwrap_or_else(|| format!("Windows refused to restart (exit code {}).", code.unwrap_or(-1)))).details(output),
    Err(e) => still_running(id, e),
  }
}

fn temp_files(emit: &dyn Fn(RepairEvent)) -> RepairResult {
  let id = RepairId::TempFiles;
  let mut total = cleanup::CleanupResult::default();
  let mut details = Vec::new();
  for folder in cleanup::temp_folders() {
    let mut r = cleanup::CleanupResult::default();
    cleanup::clean(&folder, SystemTime::now(), cleanup::MIN_AGE, &mut r);
    let line = format!("{}: removed {} files ({}), skipped {} in use", folder.display(), r.files_removed, format_bytes(r.bytes_freed), r.skipped);
    emit(RepairEvent::Line { text: line.clone() });
    details.push(line);
    total.files_removed += r.files_removed;
    total.bytes_freed += r.bytes_freed;
    total.skipped += r.skipped;
  }
  RepairResult::new(
    id,
    Outcome::Success,
    format!(
      "Freed {} by removing {} temporary files older than a day. {} files were in use and left alone.",
      format_bytes(total.bytes_freed),
      total.files_removed,
      total.skipped
    ),
  )
  .details(details)
}

fn optimize(emit: &dyn Fn(RepairEvent)) -> RepairResult {
  let id = RepairId::OptimizeDrives;
  let drive = system_drive();
  // /O picks the right method for the media: defragment an HDD, TRIM an SSD.
  match run_tool("defrag.exe", &[&drive, "/O", "/U", "/V"], LONG, emit) {
    Ok((Some(0), output)) => RepairResult::new(id, Outcome::Success, format!("{drive} was optimised (defragmented if it is a hard drive, trimmed if it is an SSD).")).details(output),
    Ok((code, output)) => RepairResult::new(id, Outcome::Failed, first_error(&output).unwrap_or_else(|| format!("Optimisation did not finish (exit code {}).", code.unwrap_or(-1)))).details(output),
    Err(e) => still_running(id, e),
  }
}

fn icon_cache(emit: &dyn Fn(RepairEvent)) -> RepairResult {
  let id = RepairId::IconCache;
  // Windows' own refresh: no need to close Explorer or delete its files.
  match run_tool("ie4uinit.exe", &["-show"], SHORT, emit) {
    Ok((_, output)) => RepairResult::new(id, Outcome::Success, "Windows was asked to refresh its icon cache. If icons are still wrong, sign out and back in.").details(output),
    Err(e) => still_running(id, e),
  }
}

/// Runs one repair. The caller holds the [`RepairGuard`].
pub fn run(repair: RepairId, emit: &dyn Fn(RepairEvent)) -> RepairResult {
  match repair {
    RepairId::DismRestore => dism(emit),
    RepairId::Sfc => sfc(emit),
    RepairId::ChkdskScan => chkdsk(emit),
    RepairId::MemoryTest => memory_test(emit),
    RepairId::WuReset => wu_reset(emit),
    RepairId::WuCache => wu_cache(emit),
    RepairId::WuServices => wu_services(emit),
    RepairId::RestorePoint => restore_point(emit),
    RepairId::SystemRestore => launch(repair, "rstrui.exe", "System Restore is open. Choose a restore point there; your personal files are kept."),
    RepairId::AdvancedStartup => advanced_startup(emit),
    RepairId::SafeMode => safe_mode(true, emit),
    RepairId::SafeModeOff => safe_mode(false, emit),
    RepairId::TempFiles => temp_files(emit),
    RepairId::OptimizeDrives => optimize(emit),
    RepairId::IconCache => icon_cache(emit),
    RepairId::StoreCache => launch(repair, "WSReset.exe", "The Microsoft Store cache is being reset. The Store opens by itself when it is done."),
    RepairId::FullRepair => full_repair(emit),
  }
}

fn full_repair(emit: &dyn Fn(RepairEvent)) -> RepairResult {
  let mut steps = Vec::new();
  for (index, step) in FULL_REPAIR_STEPS.into_iter().enumerate() {
    emit(RepairEvent::Step { index, total: FULL_REPAIR_STEPS.len(), title: step.title().to_string() });
    let result = run(step, emit);
    let stop = matches!(result.outcome, Outcome::StillRunning) || (step != RepairId::RestorePoint && result.outcome == Outcome::Failed);
    steps.push(result);
    if stop {
      break;
    }
  }
  let worst = steps.iter().map(|s| s.outcome).max_by_key(|o| severity(*o)).unwrap_or(Outcome::Success);
  let restart = steps.iter().any(|s| s.restart_recommended);
  let summary = steps.iter().map(|s| format!("{}: {}", s.title, s.summary)).collect::<Vec<_>>().join(" ");
  let mut result = RepairResult::new(RepairId::FullRepair, worst, summary);
  result.restart_recommended = restart;
  result.steps = steps;
  result
}

impl Outcome {
  /// The history entry's status (`success` or `failed`) and the result label in its log.
  pub fn history(self) -> (&'static str, &'static str) {
    match self {
      Self::Success => ("success", "No problems found"),
      Self::Repaired => ("success", "Problems found and repaired"),
      Self::Scheduled => ("success", "Scheduled for the next restart"),
      Self::Started => ("success", "Started"),
      Self::Issues => ("failed", "Problems remain"),
      Self::StillRunning => ("failed", "Still running when the time limit passed"),
      Self::Failed => ("failed", "Failed"),
    }
  }
}

fn severity(o: Outcome) -> u8 {
  match o {
    Outcome::Success | Outcome::Started | Outcome::Scheduled => 0,
    Outcome::Repaired => 1,
    Outcome::Issues => 2,
    Outcome::StillRunning => 3,
    Outcome::Failed => 4,
  }
}

pub fn format_bytes(bytes: u64) -> String {
  let units = ["B", "KB", "MB", "GB"];
  let mut value = bytes as f64;
  let mut unit = 0;
  while value >= 1024.0 && unit < units.len() - 1 {
    value /= 1024.0;
    unit += 1;
  }
  if unit == 0 { format!("{bytes} B") } else { format!("{value:.1} {}", units[unit]) }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn out(lines: &[&str]) -> Vec<String> {
    lines.iter().map(|l| l.to_string()).collect()
  }

  #[test]
  fn reads_sfc_results() {
    let ok = judge_sfc(Some(0), &out(&["Windows Resource Protection did not find any integrity violations."]));
    assert_eq!(ok.0, Outcome::Success);
    let fixed = judge_sfc(Some(0), &out(&["Windows Resource Protection found corrupt files and successfully repaired them."]));
    assert_eq!((fixed.0, fixed.2), (Outcome::Repaired, true));
    let partial = judge_sfc(Some(0), &out(&["Windows Resource Protection found corrupt files but was unable to fix some of them."]));
    assert_eq!(partial.0, Outcome::Issues);
    assert!(partial.1.contains("DISM"));
    let failed = judge_sfc(Some(1), &out(&["Windows Resource Protection could not perform the requested operation."]));
    assert_eq!(failed.0, Outcome::Failed);
  }

  #[test]
  fn reads_dism_results() {
    assert_eq!(judge_dism(Some(0), &out(&["The restore operation completed successfully."])).0, Outcome::Success);
    assert_eq!(judge_dism(Some(0), &out(&["The component store corruption was repaired.", "The operation completed successfully."])).0, Outcome::Repaired);
    let missing = judge_dism(Some(-2146498529), &out(&["Error: 0x800f081f", "The source files could not be found."]));
    assert_eq!(missing.0, Outcome::Failed);
    assert!(missing.1.contains("0x800f081f"));
  }

  #[test]
  fn reads_chkdsk_results() {
    assert_eq!(judge_chkdsk(Some(0), &out(&["Windows has scanned the file system and found no problems."])).0, Outcome::Success);
    let offline = judge_chkdsk(Some(3), &out(&["Windows has found problems that must be fixed offline.", "Please run \"chkdsk /spotfix\" to fix the issues."]));
    assert_eq!((offline.0, offline.2), (Outcome::Issues, true));
  }

  #[test]
  fn progress_lines_are_kept_out_of_the_log() {
    assert!(is_progress("[==========                 45.0%                          ]"));
    assert!(is_progress("Verification 45% complete."));
    assert!(!is_progress("The restore operation completed successfully."));
  }

  #[test]
  fn only_one_repair_at_a_time() {
    let guard = RepairGuard::default();
    let lock = guard.begin().unwrap();
    assert!(guard.begin().is_none());
    drop(lock);
    assert!(guard.begin().is_some());
  }

  #[test]
  fn ids_match_the_page() {
    let json = serde_json::to_string(&[RepairId::DismRestore, RepairId::ChkdskScan, RepairId::SafeModeOff, RepairId::FullRepair]).unwrap();
    assert_eq!(json, r#"["dism-restore","chkdsk-scan","safe-mode-off","full-repair"]"#);
  }

  #[test]
  fn system_drive_is_a_plain_letter() {
    let d = system_drive();
    assert_eq!(d.len(), 2);
    assert!(d.ends_with(':'));
  }
}
